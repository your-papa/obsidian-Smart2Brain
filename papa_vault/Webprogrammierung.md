---
related:
  - "[[HWR]]"
  - "[[4. Semester]]"
  - "[[Web]]"
created_at: 19-01-2023 16:55
tags: []
prof: Jonas Brunkow
---


# Prof Vorlesung
---
- [[TIT21_ Webprogrammierung.pdf]]

# HTML
# CSS

# Javascript
## NodeJS
### Expressjs

# Cookies
Client Seitige Session Speicherung und mehr

# REST-API
---
- Representational state transfer
- server-side statelessness is a constraint of REST - State should be stored client side (Cookies)
- HTTP Requests (CRUD) + Responses
- Model-View-Controller Pattern
- Routers binding URLs to endpoints of the views
- Models: actual Data structure where objects are stored
- Controller link between view and Models
- Middleware:
	- Serializers parsing requests, and responses (e.g. from and to json)
	- Authentications (Identification of user)
	- Permissions (If identified user is allowed to access a resource)