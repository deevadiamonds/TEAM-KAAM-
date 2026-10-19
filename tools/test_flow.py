"""End-to-end test of Team Kaam against an in-memory fake Firebase (tools/fake-backend.js).

Run:  python3 tools/test_flow.py
Needs: Python Playwright with Chromium. Does not touch the real Firebase project.
Covers: admin setup, adding members with logins, groups with Full control, giving tasks,
member login, wrong password, marking done, group lead giving a task, report, password reset.
"""
import asyncio, re, sys, tempfile, pathlib
from playwright.async_api import async_playwright

ROOT = pathlib.Path(__file__).resolve().parent.parent
TMP = pathlib.Path(tempfile.mkdtemp(prefix='tk-test-'))


def build_harness():
    src = (ROOT / 'web/index.html').read_text(encoding='utf8')
    fake = (ROOT / 'tools/fake-backend.js').read_text(encoding='utf8')
    src = re.sub(r'<!--FIREBASE-SDK-->.*?<!--/FIREBASE-SDK-->', '<script>' + fake + '</script>', src, flags=re.S)
    src = src.replace('<link rel="stylesheet" href="https://fonts.googleapis.com', '<link rel="x" href="https://fonts.googleapis.com')
    out = TMP / 'harness.html'
    out.write_text(src, encoding='utf8')
    return out


async def main():
    harness = build_harness()
    async with async_playwright() as p:
        b = await p.chromium.launch()
        pg = await b.new_page(viewport={'width': 400, 'height': 900})
        errs = []
        pg.on('pageerror', lambda e: errs.append('PAGEERR ' + str(e)))
        pg.on('console', lambda m: errs.append('CONSOLE ' + m.text) if m.type == 'error' else None)
        await pg.goto('file://' + str(harness))

        await pg.wait_for_selector('#v-setup:not([hidden])', timeout=5000)
        await pg.fill('#a-email', 'admin@gmail.com'); await pg.fill('#a-pw', 'admin123'); await pg.fill('#a-pw2', 'admin123')
        await pg.fill('#a-name', 'Owner'); await pg.fill('#a-org', 'Test Org')
        await pg.click('#a-submit')
        await pg.wait_for_selector('#v-admin:not([hidden])', timeout=5000)
        print('ok  admin setup')

        async def add(name, lid, pw, give=False):
            await pg.fill('#m-name', name); await pg.fill('#m-lid', lid); await pg.fill('#m-pw', pw)
            if give: await pg.check('#m-perm-give')
            await pg.click('#m-submit')
            await pg.wait_for_selector('#cred-card:not([hidden])', timeout=5000)
            t = await pg.inner_text('#cred-card'); assert lid in t and pw in t, t
            await pg.click('[data-act="cred-close"]')
        await add('Ramesh', 'ramesh', 'ramesh123')
        await add('Sunita', 'sunita', 'sunita123', give=True)
        await add('Ajay', 'ajay', 'ajay1234')
        print('ok  3 members with logins')

        ids = [await r.get_attribute('data-gm') for r in await pg.query_selector_all('[data-gm]')]
        await pg.fill('#g-name', 'Showroom Team')
        await pg.check(f'[data-gm="{ids[0]}"]'); await pg.select_option(f'[data-gr="{ids[0]}"]', 'full')
        await pg.check(f'[data-gm="{ids[2]}"]')
        await pg.click('#g-submit')
        await pg.wait_for_function("document.querySelector('#group-list').innerText.includes('Showroom Team')")
        print('ok  group with Full control lead')

        await pg.click('.tab[data-v="home"]')
        await pg.fill('#c-title', 'Person task for Ajay'); await pg.select_option('#c-who', ids[2]); await pg.click('#c-submit')
        await pg.wait_for_selector('#c-after:not([hidden])')
        await pg.click('[data-act="kind"][data-v="group"]')
        gid = await pg.eval_on_selector('#c-who', 's=>s.options[1].value')
        await pg.fill('#c-title', 'Group task'); await pg.select_option('#c-who', gid); await pg.check('#c-urgent'); await pg.click('#c-submit')
        await pg.wait_for_timeout(300)
        print('ok  admin gave 2 tasks')

        await pg.click('[data-act="logout"]'); await pg.wait_for_selector('#v-login:not([hidden])')
        await pg.fill('#l-id', 'ramesh'); await pg.fill('#l-pw', 'wrong'); await pg.click('#l-submit')
        await pg.wait_for_selector('#l-err:not([hidden])')
        await pg.fill('#l-pw', 'ramesh123'); await pg.click('#l-submit')
        await pg.wait_for_selector('#v-mine:not([hidden])', timeout=5000)
        assert 'Task दें' in await pg.inner_text('#tabs')
        await pg.click('#v-mine [data-act="done-open"]'); await pg.fill('#v-mine textarea[id^="note-"]', 'done note')
        await pg.click('#v-mine [data-act="done-confirm"]'); await pg.wait_for_timeout(300)
        await pg.click('.tab[data-v="home"]'); await pg.wait_for_timeout(200)
        await pg.fill('#c-title', 'Lead task for Ajay'); await pg.select_option('#c-who', ids[2]); await pg.click('#c-submit'); await pg.wait_for_timeout(300)
        store = await pg.evaluate('window.__fake.store')
        t = [v for k, v in store.items() if k.startswith('tasks/') and v['title'] == 'Lead task for Ajay'][0]
        assert t.get('viaGroup') and t['createdBy'] == ids[0]
        print('ok  group lead login, mark done, give task (viaGroup set)')

        await pg.click('[data-act="logout"]'); await pg.wait_for_selector('#v-login:not([hidden])')
        await pg.fill('#l-id', 'admin@gmail.com'); await pg.fill('#l-pw', 'admin123'); await pg.click('#l-submit')
        await pg.wait_for_selector('#v-home:not([hidden])', timeout=5000)
        await pg.click('.tab[data-v="report"]'); await pg.wait_for_timeout(300)
        rep = await pg.input_value('#r-text'); assert 'पूरे: 1' in rep, rep
        print('ok  report')

        await pg.click('.tab[data-v="admin"]')
        await pg.click(f'[data-act="m-pw"][data-v="{ids[2]}"]'); await pg.click('[data-act="m-pw-confirm"]')
        await pg.wait_for_selector('#cred-card:not([hidden])', timeout=5000)
        newpw = (await pg.inner_text('#cred-card')).split('Password')[1].split('\n')[1].strip()
        await pg.click('[data-act="logout"]'); await pg.wait_for_selector('#v-login:not([hidden])')
        await pg.fill('#l-id', 'ajay'); await pg.fill('#l-pw', 'ajay1234'); await pg.click('#l-submit')
        await pg.wait_for_selector('#l-err:not([hidden])', timeout=5000)
        await pg.fill('#l-pw', newpw); await pg.click('#l-submit')
        await pg.wait_for_selector('#v-mine:not([hidden])', timeout=5000)
        print('ok  password reset: old rejected, new works')

        # ---- visibility: only the giver, the receiver(s) and Admin see a task ----
        async def logout():
            await pg.click('[data-act="logout"]'); await pg.wait_for_selector('#v-login:not([hidden])')
        async def login(lid, pw, view):
            await pg.fill('#l-id', lid); await pg.fill('#l-pw', pw); await pg.click('#l-submit')
            await pg.wait_for_selector(f'#v-{view}:not([hidden])', timeout=5000)
        async def all_titles():
            await pg.click('.tab[data-v="all"]'); await pg.click('[data-act="fs"][data-v="all"]'); await pg.wait_for_timeout(250)
            return await pg.inner_text('#all-list')
        def mid(name):
            return [k.split('/')[1] for k, v in store().items() if k.startswith('team/') and v['name'] == name][0]
        store = lambda: pg_store
        await logout(); await login('admin@gmail.com', 'admin123', 'home')
        await pg.click('.tab[data-v="admin"]')
        for nm, lid, give in [('Nishant', 'nishant', True), ('Darshana', 'darshana', True), ('Akash', 'akash', True), ('Payal', 'payal', False)]:
            await add(nm, lid, lid + '123', give=give)
        pg_store = await pg.evaluate('window.__fake.store')
        async def give(title, who):
            await pg.click('.tab[data-v="home"]'); await pg.wait_for_timeout(150)
            await pg.click('[data-act="kind"][data-v="person"]')
            await pg.fill('#c-title', title); await pg.select_option('#c-who', who); await pg.click('#c-submit'); await pg.wait_for_timeout(250)
        await give('A-to-Payal', mid('Payal'))
        await logout(); await login('nishant', 'nishant123', 'mine')
        assert 'Report' not in await pg.inner_text('#tabs')
        await give('N-to-Darshana', mid('Darshana')); await give('N-to-Payal', mid('Payal'))
        t = await all_titles(); assert 'N-to-Darshana' in t and 'N-to-Payal' in t and 'A-to-Payal' not in t, t
        await logout(); await login('darshana', 'darshana123', 'mine')
        t = await all_titles(); assert 'N-to-Darshana' in t and 'N-to-Payal' not in t and 'A-to-Payal' not in t, t
        await logout(); await login('akash', 'akash123', 'mine')
        t = await all_titles(); assert 'N-to-' not in t and 'A-to-' not in t, t
        await logout(); await login('payal', 'payal123', 'mine')
        t = await pg.inner_text('#mine-body'); assert 'A-to-Payal' in t and 'N-to-Payal' in t and 'N-to-Darshana' not in t, t
        await pg.click('#v-mine [data-act="done-open"]'); await pg.click('#v-mine [data-act="done-confirm"]'); await pg.wait_for_timeout(300)
        done_doc = [v for k, v in (await pg.evaluate('window.__fake.store')).items() if k.startswith('tasks/') and v.get('status') == 'done' and v['title'].endswith('Payal')][0]
        assert done_doc['openFor'] == [] and done_doc['watchers'], done_doc
        await logout(); await login('admin@gmail.com', 'admin123', 'home')
        t = await all_titles(); assert all(x in t for x in ['A-to-Payal', 'N-to-Darshana', 'N-to-Payal']), t
        print('ok  visibility: giver + receiver + Admin only')
        st = await pg.evaluate('window.__fake.store')
        assert st['config/app'].get('visV2') is True, 'migration flag not set'
        assert all(isinstance(v.get('watchers'), list) and isinstance(v.get('openFor'), list) for k, v in st.items() if k.startswith('tasks/')), 'task without watchers'
        print('ok  every task has watchers/openFor')
        await pg.click('.tab[data-v="home"]'); await pg.wait_for_timeout(200)
        await pg.screenshot(path=str(TMP / 'admin-home.png'))
        print('screenshot', TMP / 'admin-home.png')

        sw = await pg.evaluate('document.documentElement.scrollWidth')
        assert sw <= 400, f'horizontal scroll {sw}'
        await b.close()
        if errs:
            print('FAIL page errors:', errs); sys.exit(1)
        print('PASS')

asyncio.run(main())
