# Team Kaam

Team को Task देने, काम पूरा होने पर वहीं mark करने और रोज़ की Report निकालने का app.
Login ID और password Admin देता है — किसी को Claude या Google account की ज़रूरत नहीं।

## इसमें क्या है

| Folder | काम |
|---|---|
| `web/` | पूरा app (HTML). GitHub Pages से अपने आप live होता है. |
| `android/` | APK — एक छोटा Android shell जो ऊपर वाला app खोलता है. |
| `firestore.rules` | Firebase की security rules — कौन क्या देख/बदल सकता है. |
| `.github/workflows/` | हर बदलाव पर website update और APK build. |

## Data कहाँ है

Firebase project `task-management-5b21b` (Authentication + Firestore). App में बदलाव `web/index.html` में होते हैं;
push करते ही website update हो जाती है और APK वाले phones में भी अगली बार खोलने पर नया version आ जाता है.

## APK

Actions → **Build APK** हर बार `android/` बदलने पर चलता है और **Releases** में `TeamKaam.apk` डालता है.
हमेशा नया APK: `https://github.com/deevadiamonds/TEAM-KAAM-/releases/latest/download/TeamKaam.apk`

## बदलाव कैसे करें

`CLAUDE.md` में पूरा ढाँचा लिखा है (files, data, permissions, test, deploy). `python3 tools/test_flow.py` नकली database पर पूरा app test करता है.
