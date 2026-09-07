# Turning on device-to-device transfer

Cadence ships with this feature **switched off**. Until you do the ten minutes below, the
"Move to another device" card simply doesn't appear and nothing else changes.

You need a free Firebase project. There is no CLI and no build step — every step is clicking in a
web console. No credit card.

## Why anything is needed at all

Two phones can't hand data to each other with nothing in between. Something has to hold the
encrypted blob for the few minutes between "send" on one device and "receive" on the other.

That something is a Firestore database in **your** Google account. What it holds is ciphertext: the
transfer code never leaves the two devices, and both the storage location and the encryption key are
derived from it. Google stores a blob it cannot read, under a name it cannot connect to you, and it
is deleted the moment it's collected.

## The steps

### 1. Make the project

1. Go to <https://console.firebase.google.com> and sign in.
2. **Add project**. Name it anything — `cadence` is fine.
3. Turn **Google Analytics off** when it offers. You don't need it and it's one less thing
   collecting data.
4. Wait for it to finish, then **Continue**.

### 2. Create the database

1. In the left sidebar: **Build → Firestore Database**.
2. **Create database**.
3. Pick a location near you. **This cannot be changed later**, but for this use it only affects
   latency by a few tens of milliseconds.
4. Choose **Start in production mode** — locked down by default. The rules in step 3 open exactly
   the one door that's needed.

### 3. Paste the security rules

This is the step that matters. Without it, either nothing works or everything is wide open.

Go to the **Rules** tab, replace everything there with this, and press **Publish**:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {

    // Parked transfers. Anyone may drop one off or pick one up, because the
    // document name is a hash of a code only the two devices know. What is
    // stored is ciphertext, so being able to fetch it is not the same as being
    // able to read it.
    match /transfers/{docId} {

      // Fetch one by name. Listing the collection is forbidden, so nobody can
      // enumerate what is waiting and work backwards.
      allow get: if true;
      allow list: if false;

      // Drop one off, once. Fixed shape, size capped, and no overwriting an
      // existing transfer.
      allow create: if request.resource.data.keys().hasOnly(['blob', 'iv', 'createdAt', 'expiresAt'])
                    && request.resource.data.blob is string
                    && request.resource.data.iv is string
                    && request.resource.data.blob.size() < 2000000
                    && !exists(/databases/$(database)/documents/transfers/$(docId));

      // Claiming deletes it. Nothing may be edited after the fact.
      allow delete: if true;
      allow update: if false;
    }

    // Everything else in the database stays shut.
    match /{document=**} {
      allow read, write: if false;
    }
  }
}
```

### 4. Make transfers expire on their own

The app deletes a transfer as soon as it's claimed, and refuses to open an expired one. This is the
backstop for the case where someone sends a code and then never uses it.

1. Firestore → **TTL** tab (it may be under **More** on a narrow window).
2. **Create policy**.
3. Collection group: `transfers`. Timestamp field: `expiresAt`.
4. Create.

Firestore will now delete parked transfers by itself, usually within a day of expiry.

### 5. Get your two values

1. Gear icon → **Project settings** → **General**.
2. Scroll to **Your apps**, click the **web** icon `</>`.
3. Nickname it anything. **Do not** tick Firebase Hosting — GitHub Pages already serves the app.
4. It shows you a config block. You need exactly two lines from it:
   - `projectId`
   - `apiKey`

### 6. Put them in the app

Open `sync.js` and fill in:

```js
const SYNC_CONFIG = {
  projectId: 'cadence-abc123',
  apiKey: 'AIzaSy...',
};
```

Bump `ASSET_V` in `sw.js` and the matching `?v=` in `index.html` and `app.html`, then commit and
push. The card appears in Settings on the next load.

**Both of those values are meant to be public.** A Firebase web API key identifies the project; it
does not authorise anything. Everything that can be done is decided by the rules you published in
step 3, which live on Google's side where nobody can edit them from a browser. This is the opposite
of, say, an Anthropic API key — that one is a secret and could never ship in a static site.

## Checking it worked

Open Settings on two devices. Send from one, type the code into the other. If something is wrong the
sheet says what — a `403` almost always means the rules in step 3 didn't publish.

## What it costs

Nothing, at any plausible scale for this. Firestore's free tier covers tens of thousands of reads
and writes a day; a transfer is one write and one read. You would have to be running this for a town
to leave the free tier, and even then the parked data is deleted continuously rather than
accumulating.

## Turning it off again

Empty the two values in `sync.js` and push. The feature disappears. To be thorough, delete the
Firebase project too — Project settings → General → bottom of the page.
