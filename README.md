# Form Template Library uploader

A small local tool for super admins to add forms to the Form Template Library (DEV-1242).

## Run

```bash
npm install
npm run dev
```

Open http://localhost:5173.

Pick the API server in the page's **API base URL** field (suggestions: local `http://localhost:8080`, `dev-platform`, `qa-platform`, `stage-platform` and the enterprise hosts; these
are lumberfi-services, not the `*-api.lumberfi.com` Django service).
The dev server forwards each call to that URL, because browsers block direct calls to the lumberfi APIs from
localhost (CORS).

## Use

1. Choose the API base URL.
2. Paste a super admin bearer token for that environment (the `Authorization` header value of a lumberfi-web request, without `Bearer `). Tokens are remembered per base URL.
3. Enter the form name: letters, digits and spaces only.
4. Paste the Form.io `components` array, or choose a `.json` file. A whole Form.io form export also works; its
   `components` array is used and its title prefills the name.
5. Upload. The library list refreshes with the new form.

Calls `POST /api/v1/form_template_library` and `GET /api/v1/form_template_library`.
