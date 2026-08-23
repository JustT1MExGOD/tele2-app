# HTTP API

> Извлечено из README §14 при репо-реструктуризации (20.11.0).

База: `https://<app>.up.railway.app`
Auth: `X-Telegram-Init-Data` (подписанный, прод) — см. `SECURITY.md`.
`X-Telegram-Id` только в деве.

| Группа | Примеры | Модуль (`backend/src/api/routes/`) |
|--------|---------|--------------------------------------|
| System | `GET /health` | `app.ts` |
| Me / access | `/me`, `/me/day`, `/me/bind`, `/me/access`, `/me/insight`, `/me/self-stats` | `me/index.ts` |
| Access requests | `/access/status`, `/access/request`, `/access/orgs`, `/access/requests`, `PUT /supervisor/:id/sector` | `org/access.ts` |
| Avatar | `POST /me/avatar`, `GET /avatars/:employeeId` | `me/avatar.ts` |
| Sales / shifts | `/sales`, `/sales/quick`, `/sales/:id/zero`, `/shifts/open\|close\|current`, `/sync/batch` | `sales.ts`, `shifts.ts` |
| Plans / schedule | `/plans/*`, `/plans/employees/*`, `/plans/stores/*`, `/schedules`, `/schedules/month`, `/schedules/bulk` | `plans.ts`, `schedules.ts` |
| BFQ / cash | `/bfq`, `/bfq/:employeeId`, `/cash/table`, `PUT /cash` | `bfq.ts`, `cash.ts` |
| Stores / org | `/stores`, `/org/stores`, `POST /employees`, `POST /stores`, `PATCH /employees/:id/role` | `org/stores.ts`, `org/employees.ts` |
| Branding | `/branding`, `/orgs`, `PUT /admin/org/:id` | `org/branding.ts` |
| Command Center / Tasks / Alerts | `/command-center`, `/tasks`, `/tasks/:id`, `/alerts`, `/alerts/:id/ack`, `/alerts/:id/status` | `analytics/command-center.ts`, `ops/tasks.ts`, `ops/alerts.ts` |
| Profiles | `/stores/:id/profile`, `/employees/:id/profile` | `profiles/store.ts`, `profiles/employee.ts` |
| Live map / what-if | `/network/live`, `/schedule/what-if`, `/schedule/what-if/apply` | `analytics/live.ts`, `analytics/what-if.ts` |
| Forecast / analytics | `/forecast/:storeId`, `/heatmap/*`, `/staffing-hints`, `/cohorts/newbies`, `/export/bi/daily` | `analytics/forecast.ts`, `analytics/heatmap.ts` |
| Reports | `/reports/day/:storeId` | `ops/reports.ts` |
| Promo / support / comms | `/promos`, `/support`, `/announcements`, `/channels/:id/messages` | `promos.ts`, `ops/support.ts`, `ops/comms.ts` |
| Supervisor | `/supervisor/dashboard`, `/supervisor/health`, `/supervisor/stores` | `analytics/supervisor.ts`, `org/access.ts` |
| Export | CSV: `/export/sales.csv`, `/export/bfq.csv`, `/export/schedules.csv` | `ops/export.ts` |
| Audit | `GET /audit` (admin-only) | `audit.ts` |
| Metrics | `/metrics` (каталог кастомных метрик) | `metrics.ts` |

Каждый роут, отдающий чужие/сетевые данные, гейтится
`requireAuth`/`requireActive`/`requireManager`/`requireSupervisor` +
org-scope — см. `SECURITY.md`.
