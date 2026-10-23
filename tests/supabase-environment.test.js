const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const clientSource = fs.readFileSync(
  path.join(__dirname, "../js/supabase/client.js"),
  "utf8"
);

function loadClient(hostname) {
  const calls = [];
  const badges = [];
  const context = vm.createContext({
    console: { log() {}, error() {}, warn() {} },
    window: {
      location: { hostname },
      supabase: {
        createClient(url, key) {
          calls.push({ url, key });
          return { url, key };
        }
      }
    },
    document: {
      readyState: "complete",
      getElementById: () => null,
      createElement: () => ({ style: {} }),
      body: { appendChild: badge => badges.push(badge) }
    }
  });
  vm.runInContext(
    `${clientSource}\nglobalThis.clientEnvironment = { IS_LOCAL, SUPABASE_URL, SUPABASE_KEY };`,
    context
  );
  return { calls, badges, environment: context.clientEnvironment };
}

test("localhost and 127.0.0.1 use only the local Supabase endpoint", () => {
  for (const hostname of ["localhost", "127.0.0.1"]) {
    const result = loadClient(hostname);
    assert.equal(result.environment.IS_LOCAL, true);
    assert.equal(result.calls[0].url, "http://127.0.0.1:54321");
    assert.match(result.calls[0].key, /^sb_publishable_/);
    assert.equal(result.badges[0].textContent, "🧪 MODE TEST LOCAL");
  }
});

test("a hosted application uses production and never a local URL", () => {
  const result = loadClient("leveling-math.example");
  assert.equal(result.environment.IS_LOCAL, false);
  assert.equal(result.calls[0].url, "https://ypfgfvwpqcamcimppxaf.supabase.co");
  assert.doesNotMatch(result.calls[0].url, /localhost|127\.0\.0\.1/);
  assert.match(result.calls[0].key, /^sb_publishable_/);
  assert.equal(result.badges.length, 0);
});

test("browser configuration contains no private Supabase credential", () => {
  assert.doesNotMatch(clientSource, /sb_secret_|SUPABASE_SERVICE_ROLE_KEY|service_role\s*[:=]/i);
  assert.doesNotMatch(clientSource, /\/functions\/v1\//);
});
