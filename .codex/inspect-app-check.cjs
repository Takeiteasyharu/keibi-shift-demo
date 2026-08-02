const cliRoot = "C:/Users/harut/AppData/Local/npm-cache/_npx/ba4f1959e38407b5/node_modules/firebase-tools/lib";
const auth = require(`${cliRoot}/auth.js`);
const apiv2 = require(`${cliRoot}/apiv2.js`);
async function request(url, allow404 = false) {
  const token = await apiv2.getAccessToken();
  const response = await fetch(url, {headers: {Authorization: `Bearer ${token}`}});
  const body = await response.json().catch(() => ({}));
  if (!response.ok && !(allow404 && response.status === 404)) throw new Error(`${response.status} ${body.error?.message || response.statusText}`);
  return response.status === 404 ? null : body;
}
async function main() {
  const account = auth.getProjectDefaultAccount(process.cwd());
  auth.setActiveAccount({}, account);
  const project = await request("https://firebase.googleapis.com/v1beta1/projects/keibi-shift-kokubunji-de-fef98");
  const service = await request(`https://firebaseappcheck.googleapis.com/v1/projects/${project.projectNumber}/services/firestore.googleapis.com`, true);
  console.log(JSON.stringify({projectNumber: project.projectNumber, appCheckFirestore: service}, null, 2));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
