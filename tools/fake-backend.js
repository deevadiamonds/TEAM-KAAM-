(function(){
  const store = {}; const accounts = {}; let current = null; const authCbs = [];
  let n = 0; const id = () => 'id' + (++n).toString(36) + Math.random().toString(36).slice(2,6);
  const clone = o => o == null ? o : JSON.parse(JSON.stringify(o));
  const tick = () => new Promise(r => setTimeout(r, 5));
  const listeners = new Set();
  function setDot(obj, dotted, val){ const ks = dotted.split('.'); let o = obj; for (let i = 0; i < ks.length - 1; i++) { if (typeof o[ks[i]] !== 'object' || o[ks[i]] === null) o[ks[i]] = {}; o = o[ks[i]]; } o[ks[ks.length-1]] = clone(val); }
  function match(d, f){ const v = d[f[0]]; switch (f[1]) {
    case '==': return v === f[2]; case 'in': return f[2].includes(v);
    case 'array-contains': return Array.isArray(v) && v.includes(f[2]);
    case '>=': return v != null && typeof v === typeof f[2] && v >= f[2];
    case '>': return v != null && typeof v === typeof f[2] && v > f[2];
    case '<': return v != null && typeof v === typeof f[2] && v < f[2];
    default: throw new Error('op ' + f[1]); } }
  function query(col, filters, opts){
    let list = Object.keys(store).filter(p => p.startsWith(col + '/') && p.split('/').length === 2)
      .map(p => ({id: p.split('/')[1], data: clone(store[p])})).filter(x => (filters || []).every(f => match(x.data, f)));
    if (opts && opts.orderBy) { const [f, dir] = opts.orderBy; list.sort((a,b) => (a.data[f] > b.data[f] ? 1 : -1) * (dir === 'desc' ? -1 : 1)); }
    if (opts && opts.limit) list = list.slice(0, opts.limit);
    return list;
  }
  function emit(){
    setTimeout(() => {
      for (const L of listeners) {
        if (L.kind === 'doc') {
          const j = JSON.stringify(store[L.path] ?? null);
          if (L.first || j !== L.last) { L.first = false; L.last = j; L.cb({exists: store[L.path] != null, data: clone(store[L.path]) || null}); }
        } else {
          const list = query(L.col, L.filters, L.opts);
          const now = new Map(list.map(x => [x.id, JSON.stringify(x.data)]));
          const changes = [];
          for (const [k, v] of now) { if (!L.last.has(k)) changes.push({type:'added', id:k, pending:false}); else if (L.last.get(k) !== v) changes.push({type:'modified', id:k, pending:false}); }
          for (const k of L.last.keys()) if (!now.has(k)) changes.push({type:'removed', id:k, pending:false});
          if (L.first || changes.length) { L.first = false; L.last = now; L.cb(list, changes, {fromCache:false}); }
        }
      }
    }, 5);
  }
  function apply(op){
    if (op.op === 'set') store[op.path] = clone(op.data);
    else if (op.op === 'update') { if (!store[op.path]) throw {code:'not-found'}; for (const [k, v] of Object.entries(op.data)) setDot(store[op.path], k, v); }
    else delete store[op.path];
  }
  const flatten = (obj, pre, out) => { out = out || {}; for (const k of Object.keys(obj)) { const v = obj[k], key = pre ? pre + '.' + k : k;
    if (v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length) flatten(v, key, out); else out[key] = v; } return out; };
  const fireAuth = () => setTimeout(() => authCbs.forEach(cb => cb(current ? {uid: current.uid, email: current.email} : null)), 5);
  window.TK_BACKEND = {
    projectId: 'test-proj',
    auth: {
      onChange: cb => { authCbs.push(cb); setTimeout(() => cb(current ? {uid: current.uid, email: current.email} : null), 5); return () => {}; },
      current: () => current ? {uid: current.uid, email: current.email} : null,
      signIn: async (email, pw) => { await tick(); const a = accounts[email]; if (!a || a.pw !== pw) throw {code:'auth/invalid-credential'}; current = a; fireAuth(); return {uid:a.uid, email}; },
      signUpSelf: async (email, pw) => { await tick(); if (accounts[email]) throw {code:'auth/email-already-in-use'}; const a = {uid: 'u_' + id(), email, pw}; accounts[email] = a; current = a; fireAuth(); return {uid:a.uid, email}; },
      signOut: async () => { current = null; fireAuth(); },
      createUser: async (email, pw) => { await tick(); if (accounts[email]) throw {code:'auth/email-already-in-use'}; const a = {uid: 'u_' + id(), email, pw}; accounts[email] = a; return a.uid; },
      changePassword: async (cur, nw) => { await tick(); if (current.pw !== cur) throw {code:'auth/invalid-credential'}; current.pw = nw; },
      sendReset: async () => { await tick(); }
    },
    db: {
      newId: () => id(),
      get: async path => { await tick(); return {exists: store[path] != null, data: clone(store[path]) || null}; },
      set: async (path, data) => { apply({op:'set', path, data}); emit(); await tick(); },
      update: async (path, data) => { apply({op:'update', path, data: flatten(data)}); emit(); await tick(); },
      del: async path => { apply({op:'delete', path}); emit(); await tick(); },
      batch: async ops => { ops.forEach(o => apply(o.op === 'update' ? Object.assign({}, o, {data: flatten(o.data)}) : o)); emit(); await tick(); },
      watchDoc: (path, cb) => { const L = {kind:'doc', path, cb, first:true}; listeners.add(L); emit(); return () => listeners.delete(L); },
      watchQuery: (col, filters, cb, err, opts) => { const L = {kind:'query', col, filters, opts, cb, first:true, last:new Map()}; listeners.add(L); emit(); return () => listeners.delete(L); },
      getQuery: async (col, filters, opts) => { await tick(); return query(col, filters, opts); }
    }
  };
  window.__fake = {store, accounts};
})();
