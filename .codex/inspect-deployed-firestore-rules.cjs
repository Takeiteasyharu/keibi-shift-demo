const cliRoot = "C:/Users/harut/AppData/Local/npm-cache/_npx/ba4f1959e38407b5/node_modules/firebase-tools/lib";
const auth = require(`${cliRoot}/auth.js`);
const apiv2 = require(`${cliRoot}/apiv2.js`);
const projectId = "keibi-shift-kokubunji-de-fef98";
async function request(url) {
  const token = await apiv2.getAccessToken();
  const response = await fetch(url, {headers: {Authorization: `Bearer ${token}`}});
  const body = await response.json();
  if (!response.ok) throw new Error(`${response.status} ${body.error?.message || response.statusText}`);
  return body;
}
async function main() {
  const account = auth.getProjectDefaultAccount(process.cwd());
  if (!account) throw new Error("Firebase CLI login required");
  auth.setActiveAccount({}, account);
  const releaseName = `projects/${projectId}/releases/cloud.firestore`;
  const release = await request(`https://firebaserules.googleapis.com/v1/${releaseName}`);
  const ruleset = await request(`https://firebaserules.googleapis.com/v1/${release.rulesetName}`);
  console.log(JSON.stringify({release: release.name, ruleset: release.rulesetName, createTime: ruleset.createTime, source: ruleset.source}, null, 2));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
