# AquaGuard — Activity Flow

How a person moves through the system, from the sign-in page onwards.
Open the Markdown Preview (`Ctrl+Shift+V`) to see the diagrams.

---

## 1. The big picture

```mermaid
flowchart LR
    A([Visitor]) --> B[Sign in / Sign up<br/>logins/index.html]
    B -->|role = Admin| C[Admin Console<br/>dashboard/admin.html]
    B -->|role = HomeOwner / WSP| D[User Dashboard<br/>dashboard/dashboard.html]
    C -->|assigns code + emails it| E[(Email inbox)]
    E -->|user copies code| D
    F[ESP32 device] -->|sensor readings + alerts| G[(Supabase DB)]
    G -->|live updates| D
    C <--> G
```

| Actor | What they do |
|---|---|
| **Home Owner / WSP** | Signs up, waits for a code by email, pairs the device, watches the dashboard |
| **Admin** (justus.kamande@strathmore.edu) | Sees all registered Home Owner/WSP accounts, assigns device codes, emails them |
| **ESP32 device** | Sends pressure readings and leak/overflow alerts to Supabase |
| **Supabase** | Login, database, security rules (RLS), live updates, email function |

---

## 2. Sign up

```mermaid
flowchart TD
    S([Open logins/index.html]) --> T[Click 'Sign Up' tab]
    T --> U[Enter name, email, phone,<br/>password, role: Home Owner or WSP]
    U --> V{Passwords match?}
    V -- No --> U
    V -- Yes --> W[Supabase creates the account]
    W --> X[profiles row saved<br/>role = HomeOwner or WSP]
    X --> Y{Email confirmation ON?}
    Y -- No --> Z[Signed in straight away<br/>→ User Dashboard]
    Y -- Yes --> AA[Check inbox → click confirm link]
    AA --> AB[Back on sign-in page:<br/>'Email confirmed! Please sign in']
```

> Nobody can sign up as Admin. The Admin role is only granted by running `sql/make_admin.sql`.

---

## 3. Sign in and role routing

```mermaid
flowchart TD
    A([Open logins/index.html]) --> B[Enter email + password]
    B --> C{Credentials valid?}
    C -- No --> D[Error banner shown] --> B
    C -- Yes --> E[Read role from profiles]
    E --> F{Role?}
    F -- Admin --> G[Admin Console<br/>admin.html]
    F -- HomeOwner / WSP --> H[User Dashboard<br/>dashboard.html]
```

Both pages re-check the role when they load:
- A non-admin who opens `admin.html` is sent to `dashboard.html`.
- An admin who opens `dashboard.html` is sent to `admin.html`.
- Anyone not signed in is sent back to the sign-in page.

### Forgot password

```mermaid
flowchart TD
    A[Click 'Forgot password'] --> B[Enter email]
    B --> C{Email registered?}
    C -- No --> D[Error: no account with that email]
    C -- Yes --> E[Reset link emailed]
    E --> F[Open link → logins/reset-password.html]
    F --> G[Set new password]
    G --> H[Back to sign-in:<br/>'Password updated']
```

---

## 4. Admin: hand out a device code

```mermaid
flowchart TD
    A([Admin signs in]) --> B[Admin Console loads:<br/>Device Codes + Home Owner & WSP Accounts]
    B --> C[Pick an account<br/>'Assign code' button or type email]
    C --> D[Pick an Unassigned code]
    D --> E{'Email the code' ticked?}
    E -- Yes --> F[Assign Device]
    E -- No --> F
    F --> G{Assignment valid?}
    G -- No: unknown email / code taken / already paired --> H[Error banner]
    G -- Yes --> I[Code reserved for that account<br/>status: Awaiting pairing]
    I --> J{Send email?}
    J -- Yes --> K[send-device-code function<br/>checks caller is Admin]
    K --> L[Email with 6-digit code<br/>sent to the reserved account only]
    J -- No --> M[Send later with<br/>'✉ Email code' in Device Codes table]
    M --> K
```

**Code status in the Device Codes table**

| Status | Meaning | Action available |
|---|---|---|
| Unassigned | Free code, nobody holds it | Assign |
| Awaiting pairing | Reserved for one account, not entered yet | ✉ Email code (send / resend) |
| Paired | The account entered the code — device is live | — |

---

## 5. User: receive code → pair → dashboard

```mermaid
flowchart TD
    A([User receives AquaGuard email<br/>with 6-digit code]) --> B[Sign in]
    B --> C{Has a paired device?}
    C -- No --> D[Pair New Device screen]
    C -- Yes --> M[Dashboard view]
    D --> E[Enter 6-digit code]
    E --> F{Code exists, unpaired,<br/>and reserved for THIS account?}
    F -- No --> G[Error: invalid code or<br/>already paired] --> E
    F -- Yes --> H[Device paired to user<br/>status: Paired]
    H --> M
```

> The check in the diamond is enforced by the database (RLS), so a code emailed to one person cannot be used by anyone else.

---

## 6. Using the dashboard

```mermaid
flowchart TD
    A([Dashboard loads]) --> B{Which sidebar item?}

    B -- Dashboard --> C[Primary Monitoring]
    C --> C1[Gauge + 5 LEDs + zone chip<br/>Normal / Warning / Critical]
    C --> C2[KPIs: Peak, Baseline,<br/>Average, Open Alerts]
    C --> C3[24h trend with warning<br/>and critical lines]
    C --> C4[Hourly averages +<br/>time-in-zone chart]
    C --> C5{Open alert?}
    C5 -- Yes --> C6[Red banner → 'Open Incident Room']

    B -- Incident Room --> D[Alerts for all my devices]
    D --> D1[Filter: All / Open / Cleared]
    D --> D2[7-day alerts chart]

    B -- Pair Device --> E[Pair another code<br/>e.g. WSP with many pipes]
    E --> C

    B -- Sign Out --> F([Back to sign-in page])
```

- **Device picker** (top right) appears when the account has 2+ devices — mainly WSPs.
- **Live updates:** new readings move the gauge, LEDs, KPIs and trend line without a refresh. New alerts show the banner and update the Incident Room count.

### Pressure zones (same rules on the website and the ESP32)

| Position in the pressure range | Zone | Gauge / LEDs |
|---|---|---|
| 0 – 60 % | Normal | Green |
| 60 – 85 % | Warning | Amber |
| 85 – 100 % | Critical | Red |

---

## 7. Device data flow (once the ESP32 is built — Phase 3)

```mermaid
sequenceDiagram
    participant ESP as ESP32
    participant DB as Supabase
    participant UI as User Dashboard

    ESP->>DB: Insert sensor reading (every few seconds)
    DB-->>UI: Live update → gauge, LEDs, chart move
    ESP->>DB: Insert alert (LEAK / OVERFLOW)
    DB-->>UI: Alert banner + Incident Room count
    Note over ESP: Physical reset button
    ESP->>DB: Mark alert as cleared
    DB-->>UI: Alert shows as Cleared
```

---

## 8. End-to-end summary

```mermaid
sequenceDiagram
    actor U as Home Owner / WSP
    actor A as Admin
    participant W as Website
    participant S as Supabase
    participant M as Email (Resend)

    U->>W: Sign up (role HomeOwner / WSP)
    W->>S: Create account + profile
    A->>W: Sign in
    W->>A: Admin Console (accounts + codes)
    A->>W: Assign code 482913 to user, tick "email"
    W->>S: Reserve code for user
    W->>S: send-device-code
    S->>M: Send email
    M->>U: "Your AquaGuard device code: 482913"
    U->>W: Sign in → Pair New Device → enter 482913
    W->>S: Claim device (RLS: reserved for this user?)
    S-->>W: Paired
    W->>U: Dashboard with gauge, charts, alerts
```

---

## Setup that must be done before this flow works

1. Supabase SQL Editor, in order: `admin_assign_device.sql` → `admin_panel_functions.sql` → `make_admin.sql` → `synthetic_data.sql`
2. Deploy the `send-device-code` Edge Function and set `RESEND_API_KEY`, `EMAIL_FROM`, `SITE_URL`
3. Resend only delivers to your own address until you verify a sending domain
