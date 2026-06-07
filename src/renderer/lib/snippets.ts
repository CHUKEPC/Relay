/**
 * Postman-style library of script snippets for the Scripts editor.
 *
 * Pure data + tiny string helpers — no Node/DOM dependencies. Each snippet's
 * `code` is a ready-to-insert JavaScript string that targets the app's `pm.*`
 * scripting API (pm.test, pm.expect, pm.response.*, pm.environment.*, etc.).
 *
 * Snippets are grouped by the script `phase` they make sense in:
 *   - 'pre'  : pre-request script only
 *   - 'test' : post-response test script only
 *   - 'both' : valid in either phase
 *
 * Every `code` value ends with a trailing newline so it inserts cleanly into an
 * existing editor buffer. Ids are stable, unique, kebab-case strings.
 */

export interface Snippet {
  id: string
  label: string
  phase: 'pre' | 'test' | 'both'
  code: string
}

export const SNIPPETS: Snippet[] = [
  // --- Status code ---------------------------------------------------------
  {
    id: 'status-200',
    label: 'Status code: Code is 200',
    phase: 'test',
    code: `pm.test("Status code is 200", function () {
    pm.response.to.have.status(200);
});
`
  },
  {
    id: 'status-2xx',
    label: 'Status code: Successful 2xx',
    phase: 'test',
    code: `pm.test("Status is 2xx", function () {
    pm.expect(pm.response.code).to.be.below(300);
    pm.expect(pm.response.code).to.be.at.least(200);
});
`
  },
  {
    id: 'status-code-name',
    label: 'Status code: Code name has string',
    phase: 'test',
    code: `pm.test("Status code name has string", function () {
    pm.response.to.have.status("OK");
});
`
  },

  // --- Response time -------------------------------------------------------
  {
    id: 'response-time-200ms',
    label: 'Response time is less than 200ms',
    phase: 'test',
    code: `pm.test("Response time < 200ms", function () {
    pm.expect(pm.response.responseTime).to.be.below(200);
});
`
  },

  // --- Response body -------------------------------------------------------
  {
    id: 'body-contains-string',
    label: 'Response body: Contains string',
    phase: 'test',
    code: `pm.test("Body contains string", function () {
    pm.expect(pm.response.text()).to.include("string");
});
`
  },
  {
    id: 'body-equals-string',
    label: 'Response body: Is equal to a string',
    phase: 'test',
    code: `pm.test("Body is equal to a string", function () {
    pm.expect(pm.response.text()).to.eql("response_body_string");
});
`
  },
  {
    id: 'body-json-value-check',
    label: 'Response body: JSON value check',
    phase: 'test',
    code: `const json = pm.response.json();
pm.test("JSON value check", function () {
    pm.expect(json.value).to.eql(100);
});
`
  },
  {
    id: 'body-to-json',
    label: 'Response body: Convert response to JSON',
    phase: 'test',
    code: `const json = pm.response.json();
console.log(json);
`
  },

  // --- Response headers ----------------------------------------------------
  {
    id: 'header-content-type-present',
    label: 'Response headers: Content-Type is present',
    phase: 'test',
    code: `pm.test("Content-Type is present", function () {
    pm.response.to.have.header("Content-Type");
});
`
  },
  {
    id: 'header-content-type-check',
    label: 'Response headers: Content-Type header check',
    phase: 'test',
    code: `pm.test("Content-Type header check", function () {
    pm.expect(pm.response.headers.get("Content-Type")).to.include("application/json");
});
`
  },

  // --- Environment / global / collection variables -------------------------
  {
    id: 'env-set',
    label: 'Set an environment variable',
    phase: 'pre',
    code: `pm.environment.set("key", "value");
`
  },
  {
    id: 'env-get',
    label: 'Get an environment variable',
    phase: 'both',
    code: `pm.environment.get("key");
`
  },
  {
    id: 'global-set',
    label: 'Set a global variable',
    phase: 'both',
    code: `pm.globals.set("key", "value");
`
  },
  {
    id: 'save-response-field-to-var',
    label: 'Save a response field to a variable',
    phase: 'test',
    code: `const json = pm.response.json();
pm.environment.set("token", json.token);
`
  },
  {
    id: 'env-clear',
    label: 'Clear an environment variable',
    phase: 'both',
    code: `pm.environment.unset("key");
`
  },
  {
    id: 'pre-set-timestamp',
    label: 'Pre-request: set a timestamp var',
    phase: 'pre',
    code: `pm.environment.set("timestamp", String(Date.now()));
`
  },
  {
    id: 'collection-var-set',
    label: 'Set a collection variable',
    phase: 'both',
    code: `pm.collectionVariables.set("key", "value");
`
  },
  {
    id: 'local-var-set',
    label: 'Set a local (this-run-only) variable',
    phase: 'both',
    code: `pm.variables.set("key", "value");
`
  },

  // --- Sending a follow-up request ----------------------------------------
  {
    id: 'send-request-get',
    label: 'Send a request (pm.sendRequest)',
    phase: 'both',
    code: `pm.sendRequest("https://postman-echo.com/get", function (err, res) {
    if (err) { console.log(err); return; }
    console.log(res.json());
});
`
  },
  {
    id: 'send-request-post',
    label: 'Send a POST request with a JSON body',
    phase: 'both',
    code: `pm.sendRequest({
    url: "https://postman-echo.com/post",
    method: "POST",
    header: { "Content-Type": "application/json" },
    body: { mode: "raw", raw: JSON.stringify({ hello: "world" }) }
}, function (err, res) {
    if (err) { console.log(err); return; }
    pm.expect(res.code).to.eql(200);
});
`
  },

  // --- Cookies -------------------------------------------------------------
  {
    id: 'cookies-get',
    label: 'Read a cookie value (pm.cookies.get)',
    phase: 'both',
    code: `const sessionId = pm.cookies.get("sessionid");
console.log(sessionId);
`
  },
  {
    id: 'cookies-jar-set',
    label: 'Set a cookie in the jar',
    phase: 'both',
    code: `pm.cookies.jar().set({ name: "token", value: "abc123", domain: "example.com", path: "/" });
`
  }
]
