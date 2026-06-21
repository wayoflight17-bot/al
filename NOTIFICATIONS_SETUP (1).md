# Push Notifications — Setup Guide (Free Plan Version)

This sends a real phone/desktop notification — even with the site fully closed — whenever a new
season starts, a new test is published, new study material is posted, or winners are announced.

This version uses **only free tools**: Firebase's free Spark plan, and GitHub's free Actions
minutes. No credit card, no paid plan, no command line needed on your end — everything below is
done by clicking around on websites.

## What you'll be uploading where

```
user_portal.html         -> your website hosting (same place as before)
sw.js                    -> same folder as user_portal.html, on your website hosting
admin_fixed.html         -> your admin panel hosting (replaces your current admin file)

github-notifications/    -> the contents of this folder go into a GitHub repository
  .github/workflows/notify.yml
  scripts/check-and-notify.js
  scripts/package.json
  .gitignore
```

The `github-notifications` folder doesn't go on your website — it goes into GitHub, where it
runs automatically on a timer in the background, checking every 5 minutes for new content and
sending notifications. You never have to run it yourself.

---

## Step 1 — Get a Firebase "service account" key (one-time, ~2 minutes)

This is a small file that lets the background checker read your Firestore database.

1. Go to https://console.firebase.google.com and open your project.
2. Click the gear icon (top left, next to "Project Overview") -> Project settings.
3. Click the Service accounts tab.
4. Click Generate new private key, then confirm. A .json file will download to your computer.
5. Open that file with Notepad (Windows) or TextEdit (Mac). Select everything and copy it.
   You'll paste this in Step 5 below. Keep this file private -- don't upload it anywhere public.
   You're only ever going to paste its contents into one place: a GitHub Secret (encrypted and
   hidden, explained in Step 5).

## Step 2 — Generate your notification keys (VAPID keys)

These two keys (a public one and a private one) let your app prove notifications are really
coming from you.

1. Go to https://web-push-codelab.glitch.me/ -- a small free tool made by Google specifically
   for generating these keys in your browser, no install needed.
2. It will show you a Public Key and a Private Key. Copy both somewhere safe temporarily.

## Step 3 — Put the Public Key into your website file

1. Open `user_portal.html` in any text editor (Notepad/TextEdit works fine).
2. Search for: VAPID_PUBLIC_KEY
3. You'll see a line like:
   `const VAPID_PUBLIC_KEY = 'PASTE_YOUR_VAPID_PUBLIC_KEY_HERE';`
4. Replace the text between the quotes with your real Public Key from Step 2, keeping the
   quotes. Save the file.
5. Upload this updated `user_portal.html` to your website, replacing the old one. Make sure
   `sw.js` is uploaded too, in that exact same folder.

## Step 4 — Upload the updated admin file

Upload `admin_fixed.html` to wherever your admin panel currently lives, replacing the old file.
This includes a couple of small fixes needed for notifications to detect new content correctly.

## Step 5 — Create a GitHub repository and upload the checker

1. Go to https://github.com and log in (or create a free account).
2. Click the + icon top-right -> New repository.
3. Name it anything, e.g. way-of-light-notifications. It can be Private. Click Create
   repository.
4. On the new repository's page, click Add file -> Upload files.
5. Drag in everything from the `github-notifications` folder you were given -- keep the folder
   structure exactly as it is.
6. Click Commit changes at the bottom.

## Step 6 — Add your secrets

This is where the service account key and VAPID keys actually get stored -- encrypted, never
visible in your code or to anyone browsing the repository.

1. In your repository, click Settings (top menu of the repo, not your account settings).
2. Left sidebar: Secrets and variables -> Actions.
3. Click New repository secret and add each of these, one at a time (exact names matter):

   - FIREBASE_SERVICE_ACCOUNT_JSON -> the entire contents of the .json file from Step 1
   - VAPID_PUBLIC_KEY -> the Public Key from Step 2
   - VAPID_PRIVATE_KEY -> the Private Key from Step 2
   - VAPID_CONTACT_EMAIL -> any email address you check, e.g. you@example.com

   You can optionally also add APP_ID if your app's ID isn't "way-of-light-v3" -- if you're not
   sure, skip this one, it defaults correctly already.

## Step 7 — Turn it on

1. In your repository, click the Actions tab.
2. You should see a workflow called "Check for new content and send notifications".
3. If GitHub shows a button asking you to enable Actions for this repo, click it.
4. Click the workflow name, then click Run workflow (top right) to test it immediately rather
   than waiting for the timer.
5. Click the run that appears to watch it work. Green check = success. Red X = something needs
   fixing (see Troubleshooting below).

From now on it runs automatically every 5 minutes on its own.

## Step 8 — Let users turn on notifications

In the app, anyone who wants notifications goes to Profile -> Push Notifications -> Enable, and
accepts the permission prompt their browser shows. That's the only thing each user needs to do.

---

## Testing it end to end

1. Make sure you've enabled notifications on at least one device (Step 8).
2. From the admin panel, publish a new test (or season, or study material).
3. Within 5 minutes you should get a real notification -- try it with the website fully closed
   to see the difference from before.
4. To check it ran without waiting: Actions tab -> click the workflow -> Run workflow.

## Troubleshooting

- Red X on the Action run: click into it, click the failed step, read the red error text. The
  most common cause is a secret pasted with extra spaces or missing characters -- delete that
  secret and re-add it carefully.
- "Missing one or more required secrets": one of the four secret names in Step 6 doesn't exactly
  match what's listed (case-sensitive).
- It runs green but no notification arrives: confirm you completed Step 8 on the device you're
  testing with, and that you chose "Allow" (not "Block") for notification permission.
- Notifications worked, then stopped for one specific device: handled automatically -- if a
  device's subscription goes stale (uninstalled, permission revoked), the checker quietly
  removes it. That device just needs to tap Enable again.
- Want it to check more often than every 5 minutes? Open .github/workflows/notify.yml in the
  repository, find the line with */5, and change it to */2 for every 2 minutes. GitHub's free
  tier comfortably supports this for a project this size. Scheduled runs aren't always exact to
  the minute -- an occasional few-minute delay during high load is normal, not a sign of
  anything broken.
