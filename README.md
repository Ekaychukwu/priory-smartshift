# Priory SmartShift

Priory SmartShift is a full‑stack proof‑of‑concept for managing hospital
staff attendance and wellbeing via WhatsApp and a modern web dashboard.
It replicates and extends the logic of an existing no‑code workflow
(Make.com and Airtable) by providing RESTful endpoints, JWT‑based
authentication, role‑based access control, AI‑powered wellbeing
analysis and daily summaries.  Data is persisted to a JSON file for
simplicity, but the project structure makes it easy to swap in a real
PostgreSQL or Supabase database.

## Prerequisites

The server runs on Node.js and uses no third‑party dependencies other
than the built‑in modules.  To send WhatsApp messages and perform
wellbeing analysis you will need accounts and API keys for Twilio and
OpenAI.  Without these keys the server still functions but replies will
not be sent and tone analysis will return a neutral stub response.  A
secret string (`JWT_SECRET`) is required for signing JSON Web Tokens.

1. [Node.js](https://nodejs.org/) 16 or later installed locally.
2. A Twilio account with WhatsApp sandbox or production access.
3. An OpenAI API key (GPT‑4o‑mini or compatible model).
4. A secret string for signing JSON Web Tokens (`JWT_SECRET`).

## Setup

1. **Clone or unpack the project**

   ```bash
   git clone <repository-url>
   cd priory-smartshift
   ```

2. **Create a `.env` file** based on the provided `.env.example`.  At a
   minimum you should set your Twilio and OpenAI credentials, a JWT
   secret and a port:

   ```env
   TWILIO_ACCOUNT_SID=ACXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
   TWILIO_AUTH_TOKEN=your_auth_token
   TWILIO_WHATSAPP_NUMBER=+14155238886
   OPENAI_API_KEY=sk-…
   JWT_SECRET=supersecretkey
   CRON_INTERVAL=24h
   PORT=3000

    # Payroll configuration
    PAY_PERIOD_DAYS=30
    # Default hourly rate for payroll calculations (in pounds).  A
    # standard shift is 12 hours including a 1 hour unpaid break (11 paid hours).
    BASE_RATE_DEFAULT=12.10
    OVERTIME_MULTIPLIER=1.5

    # AI model used for payroll and wellbeing summaries
    AI_MODEL=gpt-4o-mini
   ```

3. **Run the server**.  Because there are no external dependencies you
   can start the server immediately:

   ```bash
   node index.js
   ```

   You should see a message similar to:

   ```
   Priory SmartShift server listening on port 3000
   ```

4. **Expose the webhook to Twilio**.  In order to receive WhatsApp
   messages from Twilio you must expose your local server to the
   internet.  You can use a tunnelling service such as [ngrok](https://ngrok.com/)
   or deploy the server to a hosting platform like Render or Replit.
   Configure your Twilio WhatsApp sandbox to send incoming messages to
   `https://your-public-url/api/whatsapp/webhook`.

## Multi‑Tenant Mode

In multi‑tenant deployments, Priory SmartShift can host multiple
organisations (hospitals, clinics or care groups) within a single
instance while keeping their data strictly separated.  To enable
multi‑tenant mode set `MULTI_TENANT=true` in your `.env` file and
define a base domain (e.g. `smartshift.app`).  Each organisation is
represented by an entry in the `organisations` table with a unique
`subdomain` such as `priory` or `elysium`.  When a user logs in or
registers, they must specify their `org_subdomain`, and all
subsequent API calls are scoped under `/api/{orgId}`.  For example,
for the organisation with subdomain `priory` the shifts endpoint is
`/api/priory/shifts`.

When deploying, configure your DNS or hosting platform to route
subdomains (e.g. `priory.smartshift.app`, `elysium.smartshift.app`) to
the frontend.  The React dashboard automatically extracts the
subdomain from `window.location.hostname` to determine the
organisation context.  Global endpoints like `/api/auth/login` and
`/api/auth/register` remain unscoped and should still be called on the
base API URL.

### Additional Environment Variables

```
MULTI_TENANT=true
BASE_DOMAIN=smartshift.app
STRIPE_PUBLIC_KEY=pk_live_...
STRIPE_SECRET_KEY=sk_live_...
```

These variables prepare the application for future Stripe integration
and multi‑subdomain routing.  For billing and usage tracking, the
`organisation_billing` table stores plan type, active users, logged
hours and cost per organisation.  The `/api/billing/summary/:orgId`
and `/api/billing/update-plan` endpoints provide a placeholder API for
super administrators to view or change organisation plans.

### Predictive Analytics Configuration

To enable the built‑in predictive analytics and snapshot scheduler,
define the following variables in your `.env` file:

```
# Cron expression (in standard cron syntax) controlling when to
# generate analytics snapshots.  The default "0 5 * * *" means
# daily at 05:00.  The server will approximate this by running the
# snapshot generator once per day.  External schedulers should
# honour this value.
ANALYTICS_REFRESH_CRON="0 5 * * *"

# URL of an external machine‑learning service for forecasting.  When
# set, the predictive endpoints may delegate to this service.  Leave
# blank to use the internal heuristic implementation.
ML_SERVICE_URL=

# Default number of days over which to forecast open shifts and costs
# for the `/api/{orgId}/ai/predict` endpoint.  Can be overridden via
# the `window` query parameter.
PREDICTION_WINDOW_DAYS=7
```

## Endpoints

### Authentication

All protected routes require an `Authorization: Bearer <token>` header.
Tokens are returned by the login and register endpoints and should be
stored in the browser (e.g. `localStorage`) by the frontend.

#### `POST /api/auth/register`

Creates a new user.  Body parameters: `name`, `email`, `password` and
optional `role` (`staff`, `manager` or `admin`).  Staff and managers
are automatically linked to a new staff record.  Returns `{ user,
token }`.

#### `POST /api/auth/login`

Authenticates an existing user.  Body: `email`, `password`.  Returns
`{ user, token }` on success.

#### `GET /api/auth/profile`

Returns the authenticated user's profile.  Requires a valid bearer
token.

#### `POST /api/auth/password-reset`

Simulates a password reset by printing a one‑time token to the
console.

### Shift & Staff Management

#### `POST /api/whatsapp/webhook`

Receives inbound WhatsApp messages from Twilio.  The body is expected to
contain `From` and `Body` fields (as sent by Twilio).  Supported commands:

* `ACCEPT <SHIFT_REF>` – Assigns the sender to the specified shift.
* `DECLINE <SHIFT_REF>` – Records that the sender has declined the shift.

All messages are stored in `wellbeing_logs` along with a simple tone
analysis.  The server replies via WhatsApp confirming the action or
explaining any errors.

#### `GET /api/shifts`

Lists all shifts.  Accepts optional query parameters `status`, `ward`
and `role` for filtering.  Requires authentication.  Admins and
managers typically use this endpoint to view and manage shifts.

#### `POST /api/shifts/:id/accept`

Accepts or fills a shift.  When called by a staff or manager user, the
endpoint enforces business rules (maximum of six consecutive shifts
and no day/night conflicts), records the assignment in
`shift_assignments`, increments `number_filled` and marks the shift as
filled when the required number is reached.  Admins can use this
endpoint to mark a shift as filled immediately.  Returns an error
message if rules are violated.

#### `GET /api/staff/:id`

Returns dashboard data for the specified staff member.  Staff users may
only access their own data; admins and managers can access any staff.
The response includes:

* `available_shifts` – open shifts that can be accepted
* `accepted_shifts` – shifts the staff member has accepted
* `cumulative_hours` – hours worked (12 × accepted shifts)
* `upcoming_schedule` – accepted shifts sorted by date
* `wellbeing_history` – daily wellbeing summaries for this staff member

### Wellbeing & AI

#### `GET /api/wellbeing/analyze?text=…`

Performs a sentiment/tone analysis on the provided `text` using the
OpenAI API.  Requires authentication.  If no `OPENAI_API_KEY` is
configured, returns a neutral response.

#### `POST /api/ai/generate-summaries`

Generates daily wellbeing summaries for all staff based on recent
messages and shift notes.  Only admins and managers may call this
endpoint.  The summaries are stored in `wellbeing_summaries` with
fields `staff_id`, `summary`, `score` and `date`.

#### `GET /api/ai/wellbeing/today`

Returns the wellbeing summaries generated for the current date.  Used
by the dashboard to display average wellbeing and chart data.

### Payroll

#### `GET /api/payroll`

Lists payroll records with optional filtering by date, staff or ward (query parameters `start_date`, `end_date`, `staff_id`, `ward`).  Accessible to admins and managers only.

#### `GET /api/payroll/:id`

Returns a single payroll record by its ID.

#### `POST /api/payroll/generate`

Manually generates payroll records for completed shifts that have not yet been processed.  Useful for on‑demand recalculation.  Returns the newly created records.

#### `GET /api/payroll/summary`

Returns aggregated totals of hours worked, overtime and cost for the current period, plus a breakdown by ward.

### Performance

#### `GET /api/performance/daily`

Returns average punctuality and wellbeing scores for today, grouped by ward.

#### `GET /api/performance/staff/:id`

Returns the last 30 days of performance metrics for a given staff member (dates, punctuality, completion and wellbeing arrays).  Staff can view only their own data; admins and managers can view any staff.

#### `GET /api/performance/leaderboard`

Returns a leaderboard of staff sorted by average completion and punctuality scores.  Accessible to admins and managers.

### AI Payroll

#### `POST /api/ai/payroll/auto-close`

Triggers automatic closure of payroll for completed shifts by generating payroll records.  Intended to run as a cron job but can be invoked manually.  Accessible to admins and managers.

#### `GET /api/ai/payroll/summary`

Generates a natural language summary of the current payroll and performance data using the OpenAI API.  If AI is unavailable the endpoint returns the raw aggregated data.

### Predictive Analytics

Priory SmartShift includes a lightweight predictive analytics module that
forecasts staffing demand, identifies burnout risks and estimates
labour costs.  These endpoints require authentication and are
restricted to admin or manager roles.

#### `GET /api/{orgId}/ai/predict`

Returns a forecast for the next prediction window (default 7 days).
Query parameter `window` can override the number of days.  Response
structure:

```
{
  "forecast_date": "2025-11-13",
  "expected_open_shifts": 42,
  "burnout_alerts": [{"staff": "John Doe", "risk": 0.83}],
  "cost_forecast": 118540.75
}
```

#### `POST /api/{orgId}/ai/simulate`

Runs a simple “digital twin” simulation.  The JSON body accepts keys
`ward`, `added_staff`, `removed_staff` and `extra_hours`.  The
response contains baseline predictions and scenario adjustments:

```
{
  "baseline": { … },
  "scenario": {
    "expected_open_shifts": 38,
    "cost_forecast": 120000.50,
    "wellbeing_score": 4.7
  }
}
```

#### `GET /api/{orgId}/ai/insight`

Calls the forecast internally and uses the OpenAI API to generate a
plain‑English narrative summary and recommendations.  Returns:

```
{
  "summary": "Ward A is likely to face a 12 % shortfall in night‑shift coverage next week; …",
  "details": { … }
}
```

#### `POST /api/{orgId}/ai/refresh-snapshots`

This optional endpoint triggers the generation of an analytics
snapshot for the organisation.  Snapshots are also created daily via
the built‑in scheduler when `ANALYTICS_REFRESH_CRON` is set.

### Reports

## Business logic

* A shift cannot be accepted if it is already filled or has no remaining
  slots.
* Staff may not accept more than six consecutive shifts.  A simple
  counter of recent assignments is used to enforce this rule.
* Staff may not work a day shift followed immediately by a night shift
  (or vice versa) within a 12‑hour window.  The server inspects the
  start times of successive assignments to enforce this.
* For payroll calculations, each shift is 12 hours including a 1 hour
  unpaid break, so only 11 hours are counted as paid work.  Overtime is
  calculated on the basis of a 37.5‑hour work week (7.5 hours per day);
  any paid hours above this threshold are paid at 1.5× the base rate.
* Every inbound WhatsApp message is analysed for tone and stored in
  `wellbeing_logs`.  You can use this data to monitor staff morale over
  time.

## Database design

This proof‑of‑concept uses a flat JSON file (`database.json`) to persist
data.  The structure mirrors the PostgreSQL tables described in the
specification:

| Collection          | Notes                                            |
|---------------------|--------------------------------------------------|
| **shifts**          | Holds shift metadata: `shift_ref`, `ward`, `role_required`, `status`, `shift_date`, `number_required`, `number_filled` |
| **staff**           | Basic staff records: `name`, `phone_number`, `preferred_shift`, `wellbeing_score` |
| **wellbeing_logs**  | Raw WhatsApp messages plus tone analysis         |
| **shift_assignments** | Records which staff accepted which shift and when |
| **users**           | Accounts for authentication (name, email, password_hash, role, staff_id) |
| **wellbeing_summaries** | Daily AI‑generated summaries per staff member |

Switching to a real PostgreSQL or Supabase database is straightforward:
replace `src/utils/db.js` with calls to your preferred ORM (e.g.
Sequelize or Prisma) and remove the JSON persistence logic.

## Postman collection

A simple Postman collection is included in the `postman` folder (see
`priory-smartshift.postman_collection.json`).  Import this file into
Postman to test the `/api/whatsapp/webhook`, `/api/shifts`, and
`/api/wellbeing/analyze` endpoints.

## Deployment

To deploy the server on platforms such as Render, Replit or Railway:

1. Create a new Node.js service on your chosen platform.
2. Upload the contents of this repository or connect it via Git.
3. Set the environment variables in your platform's settings using the
   values from your `.env` file.
4. Configure your Twilio WhatsApp webhook to point at the public URL
   provided by the platform (e.g. `https://my-smartshift.onrender.com/api/whatsapp/webhook`).

Due to the constraints of this coding environment the project cannot be
deployed automatically here.  The provided code and instructions allow
you to deploy it yourself quickly.