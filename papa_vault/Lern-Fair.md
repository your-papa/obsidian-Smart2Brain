---
related:
  - "[[Home (PAPA)]]"
created_at: 21-10-2022 11:05
tags:
  - MoC
banner: "![[Pasted image 20230330162139.png]]"
banner_y: 0.44999
banner_icon: 🐦
cssclasses:
  - banner-bug
color: "#F1FA8C"
---

> [!todo]+ Tasks
> - [ ] LF Team Meeting 20 Uhr 🔁 every 2 weeks ⏳ 2023-10-04
> - [x] LF Team Meeting 20 Uhr 🔁 every 2 weeks ⏳ 2023-09-20 ✅ 2023-09-20
> - [ ] refactor dependency loop linting warnings 🔽 
> - [ ] [Hide Notification Panel for Screeners · Issue #931 · corona-school/project-user (github.com)](https://github.com/corona-school/project-user/issues/931) 🛫 2023-09-29 📅 2023-10-02 
> - [ ] [Screeners should be able to deactivate accounts without an open screening request · Issue #926 · corona-school/project-user (github.com)](https://github.com/corona-school/project-user/issues/926) 📅 2023-10-04
> - [x] [Show E-Mail to Screeners · Issue #925 · corona-school/project-user (github.com)](https://github.com/corona-school/project-user/issues/925) 🛫 2023-09-21 📅 2023-09-28 ✅ 2023-09-28

> [!done]-
> - [x] Improve Linting LF (--fix) 📅 2023-08-20 ✅ 2023-08-24
> - [x] Check if automatic course promotion works 📅 2023-08-28 ✅ 2023-08-31
> - [x] LF Team Meeting 20 Uhr 🔁 every 2 weeks ⏳ 2023-08-23 ✅ 2023-08-23
> - [x] LF Team Meeting 20 Uhr 🔁 every 2 weeks ⏳ 2023-08-09 ✅ 2023-08-09
> - [x] Tech Update if deployed: Automatic Promotions ✅ 2023-08-09
> - [x] LF Telefonat mit Maria - Einfach 350€ ehrenamtspauschale ⏳ 2023-08-23 ✅ 2023-08-23
> - [x] Team Meeting 20 Uhr 🔁 every 2 weeks ⏳ 2023-07-13 ✅ 2023-07-16
> - [x] Team Meeting 11 Uhr 🔁 every 2 weeks ⏳ 2023-06-15 ✅ 2023-06-15
> - [x] Team Meeting 11 Uhr 🔁 every 2 weeks ⏳ 2023-06-01 ✅ 2023-06-01
> - [x] Resolve [Weekly Promotion of Subcourses](https://github.com/corona-school/project-user/issues/741) 📅 2023-07-30 ✅ 2023-08-01
> - [x] Resolve [Erfassung von Screening Daten](https://www.notion.so/lern-fair/2677153323924c5fbc7685d471c4c029?v=75508bf7cdfc455caf9a82c9859665ef&p=29dfbab39b82462f9e04680d5e7e2b3b&pm=s) 📅 2023-06-08 ✅ 2023-06-14
> - [x] Resolve [make course promotions more resilient](https://github.com/orgs/corona-school/projects/8/views/4?pane=issue&itemId=27384157) 🔼 📅 2023-05-29 ✅ 2023-05-31
> - [x] Team Meeting 11 Uhr 🔁 every 2 weeks ⏳ 2023-05-18 ✅ 2023-05-18
> - [x] Resolve: [Make File Storage more robust](https://github.com/corona-school/project-user/issues/731) 🔼 📅 2023-05-14 ✅ 2023-05-16
> - [x] [Review](https://github.com/corona-school/user-app/pull/236) ✅ 2023-04-07
> - [x] [Issue](https://github.com/corona-school/project-user/issues/575) resolven 🔼 🛫 2023-04-07 📅 2023-04-10 ✅ 2023-04-09
> - [x] Resolve Issue: [handle race-conditions](https://github.com/corona-school/project-user/issues/667) 🔼 📅 2023-04-20 ✅ 2023-04-23
> - [x] Team Meeting 11 Uhr 🔁 every 2 weeks ⏳ 2023-05-04 ✅ 2023-05-04
> - [x] Team Meeting 20 Uhr 🔁 every 2 weeks ⏳ 2023-04-20 ✅ 2023-04-20
> - [x] Linting Issue resolven 🔼 📅 2023-05-04 ✅ 2023-05-04
> - [x] neues issue raussuchen 🔼 📅 2023-05-18 ✅ 2023-05-10
> - [x] [Review](https://github.com/corona-school/backend/pull/562) ✅ 2023-04-06
> - [x] Team Meeting 20 Uhr 🔁 every 2 weeks ⏳ 2023-04-06 ✅ 2023-04-06
> - [x] [Issue](https://github.com/corona-school/project-user/issues/611) resolven ⏫ 📅 2023-04-03 ✅ 2023-04-03

# Engagement Work
---
Platform to connect educational disadvantaged children with students.
**Website:**
- https://www.lern-fair.de/

# Development
---
## Github
- https://github.com/corona-school
Mostly working on the backend. Migrating REST-API to GraphQL-API
Issue tracking in [project-user repo](https://github.com/corona-school/project-user) 

## Backend
---
### Spin up backend
Start postgres db
```bash
docker run --rm -p 5432:5432 -e POSTGRES_PASSWORD=secretpw postgres
```

(in .env:)
```bash
DATABASE_URL=postgres://postgres:secretpw@localhost:5432
```

Start lernfair backend
```bash
npm run web:dev
```

**For better debugging (less logging):**
Wenn man in der Apollo UI unter Settings das Polling ausschaltet:
`"schema.polling.enable": false,`
-> dann fetcht die UI nicht ständig das Schema neu und man hat weniger GraphQL requests

### GraphQL Walkthrough
**GraphQL Endpoint:** https://localhost:5000/apollo
- POST request can be sent to actually run GraphQL queries
- GET shows an interactive UI

**Authorization header for authentication**
As admin:
- Basic Authentication: when `ADMIN_AUTH_TOKEN=admin`, dann sollte `{ "authorization": "Basic YWRtaW46YWRtaW4=" }` reichen, auch ohne login -> base64 encode "admin:admin"
- (When on dev stage): `{ "authorization": "Basic YWRtaW46SFo5NTU3Qk1HUEZRMlBWWjY5Q05MVkZCQjJUQTRIUEY=" }` with token `HZ9557BMGPFQ2PVZ69CNLVFBB2TA4HPF`

Login with test users:
- Bearer Session Authentication: for users - the session is generated at the client:  pass in a long and random string as a session token (e.g `{ "authorization": "Bearer 280d2c48-6737-4f07-859f-9059ddcca8ab" }`)
```
mutation login{
	loginPassword(email:"test+dev+p1@lern-fair.de", password: "test")
}
```


### How to apply DB/Model changes (Migrations)
---
#TODO they are now fully prisma based and updated in the README
#### Prerequisites
It is necessary to have a local postgres database for development with the credentials stored in the corresponding environment variables when creating the migrations. This database is later used to store the state of the `master` branch which is then compared by TypeORM to the state on the target branch.

#### Steps
Migrate via TypeORM (not SOTA but it works)
You'll need to perform the following steps to use TypeORM's auto generation feature for migrations: 

1. Make sure your branch is up-to-date with remote branch `master`
2. Change your local branch to `master`
3. Run command `npm run build:clean && npm run web:dev`. Your local db is now in the state defined by the current code on the `master` branch.
4. Change back to your branch with changes to entity in /common/entitiy
5. Generate a migration file with the command `npm run db:migration:generate NAME_OF_MIGRATION` where _NAME_OF_MIGRATION_ is a simple and short description of what the new migration should do. 
6. Check the generated file and delete unnecessary statements in _up_ like `ALTER COLUMN "verification" SET DEFAULT null` and in _down_ like `ALTER COLUMN "verification" DROP DEFAULT` (please also see https://github.com/typeorm/typeorm/issues/3076)
7. run `npm run build:clean && npm run web:dev` again to apply changes to running db
8. run `npx prisma db pull` (apply db tables to prisma.schema) and `npx prisma generate` (to generate GraphQL CRUD resolvers and types)
9. new models are now available in code

# Other Tools
---
Passwords are in my Private Vault
## Retool
- https://login.retool.com/auth/login
## Matomo
- https://lernfair.matomo.cloud
## Datadog
- https://app.datadoghq.eu/

# Verein Beitrittsantrag
---
[[Mitglieder_Aufnahmeantrag_Leonard_Heininger.pdf]]