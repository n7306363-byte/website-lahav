# מערכת הניהול של האתר — הגדרה חד־פעמית

דף הניהול נמצא בכתובת **`/admin/`** (למשל `https://website-lahav.vercel.app/admin/`).
התחברות עם חשבון גוגל מורשה → עריכת טקסטים/תמונות → **שמור ופרסם** → האתר מתעדכן תוך כ־30 שניות.

## איך זה עובד
- כל התוכן הניתן לעריכה נמצא בקובץ `content.json`.
- `template.html` הוא תבנית העמוד (העיצוב). `index.html` נוצר ממנה אוטומטית.
- כשלוחצים "שמור ופרסם", הפונקציה `api/save.js` מאמתת את החשבון, בונה את `index.html` ושומרת commit אחד בגיטהאב
  (`content.json` + `index.html` + תמונות חדשות). Vercel מזהה את ה־commit ומפרסם.
- כל שינוי נשמר בהיסטוריית גיטהאב, כך שאפשר תמיד לחזור לגרסה קודמת.

> **חשוב למי שעורך את קוד האתר:** שינויי עיצוב עושים ב־`template.html` ואז מריצים `node tools/build.js`
> (לא עורכים את `index.html` ישירות, אחרת השמירה הבאה מהניהול תדרוס אותם).

## מה אפשר לערוך
ההירו · הסיפור שלנו · כותרות הסקשנים · 3 פרוייקטים (כותרת, טקסט, תמונה ראשית, 4 תמונות נוספות) ·
3 כרטיסיות שירות (כותרת, תמונה, רקע, צבע) · 4 המלצות (שם, טקסט, תמונה).
מספר הפרוייקטים/הכרטיסיות/ההמלצות קבוע כדי לשמור על העיצוב.

## הגדרה (פעם אחת) — 3 שלבים

### 1. מזהה התחברות של גוגל (Client ID)
1. נכנסים ל־<https://console.cloud.google.com/> ויוצרים פרויקט (או משתמשים בקיים).
2. **APIs & Services → OAuth consent screen**: סוג *External*, שם אפליקציה (למשל "ניהול אתר להב"), מייל תמיכה.
   אם הסטטוס נשאר *Testing* — מוסיפים ב־**Test users** את כתובות הגוגל שיעבדו בניהול. אפשר גם ללחוץ *Publish app*.
3. **APIs & Services → Credentials → Create credentials → OAuth client ID**:
   סוג *Web application*, ב־**Authorized JavaScript origins** מוסיפים `https://website-lahav.vercel.app`
   (ואת הדומיין העסקי כשיהיה). אין צורך ב־redirect URI.
4. מעתיקים את ה־**Client ID** (נראה כך: `1234567890-abc.apps.googleusercontent.com`).

### 2. מפתח גיטהאב (לשמירת השינויים)
1. <https://github.com/settings/personal-access-tokens/new> → **Fine-grained token**.
2. *Repository access*: **Only select repositories** → `website-lahav`.
3. *Repository permissions*: **Contents → Read and write** (אין צורך בשום הרשאה אחרת).
4. תוקף: שנה (ואז מחדשים). מעתיקים את הטוקן.

### 3. משתני סביבה ב־Vercel
פרויקט `website-lahav` → **Settings → Environment Variables** → מוסיפים (לכל הסביבות):

| שם | ערך |
|---|---|
| `GOOGLE_CLIENT_ID` | ה־Client ID משלב 1 |
| `ALLOWED_EMAILS` | כתובות גוגל מורשות, מופרדות בפסיק: `me@gmail.com,partner@gmail.com` |
| `GITHUB_TOKEN` | הטוקן משלב 2 (לסמן **Sensitive**) |

אחרי ההוספה: **Deployments → … → Redeploy** (כדי שהמשתנים ייכנסו).

## בדיקה
פותחים `/admin/` → "כניסה באמצעות Google" → משנים כותרת → **שמור ופרסם** → אחרי ~30 שניות מרעננים את האתר.

## בדיקה מקומית (בלי גיטהאב)
```bash
node tools/test.js          # בדיקות רינדור/ולידציה
node tools/devserver.js     # http://localhost:8091/admin/ — כניסת פיתוח, שמירה ל־.dev-out/
```

## אבטחה
- רק חשבונות מהרשימה `ALLOWED_EMAILS` יכולים לשמור; האימות נעשה בשרת מול גוגל.
- הטוקן של גיטהאב נשמר רק ב־Vercel, לא בקוד ולא בדפדפן.
- תוכן האתר (`content.json`) ציבורי מטבעו — זה אותו תוכן שמוצג באתר.
