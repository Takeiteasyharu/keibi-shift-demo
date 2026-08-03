import { db } from "./firebase-config.js";
import {
  collection,
  getDocs,
  query,
  where
} from "https://www.gstatic.com/firebasejs/11.10.0/firebase-firestore.js";
import { ALL_BRANCHES, branchName, effectiveBranchId, isOperationalAccount } from "./branches.js";

let el;
let navigate;
let openCalendar;
let currentProfile;
let currentRole;
let workers = [];

export function initProxyInput(elements, showScreen, openProxyCalendar) {
  el = elements;
  navigate = showScreen;
  openCalendar = openProxyCalendar;
  el.proxyWorkerSearch.addEventListener("input", render);
}

export async function showProxyWorkerList(profile = currentProfile, role = currentRole) {
  if (profile) currentProfile = profile;
  if (role) currentRole = role;
  if (!["staff", "admin"].includes(currentRole?.role)) throw new Error("勤務希望を編集する権限がありません。");
  navigate("proxyWorkers");
  el.proxyWorkerMessage.className = "message";
  try {
    const branchId = effectiveBranchId(currentRole);
    const allBranches = currentRole.role === "admin" && branchId === ALL_BRANCHES;
    const [usersSnapshot, rolesSnapshot] = await Promise.all([
      getDocs(allBranches ? collection(db, "users") : query(collection(db, "users"), where("branchId", "==", branchId))),
      getDocs(allBranches ? collection(db, "userRoles") : query(collection(db, "userRoles"), where("branchId", "==", branchId)))
    ]);
    const roles = new Map(rolesSnapshot.docs.map(item => [item.id, item.data()]));
    workers = usersSnapshot.docs
      .map(item => ({ id: item.id, uid: item.id, ...item.data(), accountStatus: roles.get(item.id)?.accountStatus }))
      .filter(worker => (allBranches || worker.branchId === branchId) && worker.inputMode === "managed" && isOperationalAccount(worker.accountStatus))
      .sort((a, b) => String(a.employeeNumber).localeCompare(String(b.employeeNumber), "ja"));
    render();
  } catch (error) {
    console.error(error);
    el.proxyWorkerMessage.textContent = "勤務希望の編集対象者を読み込めませんでした。";
    el.proxyWorkerMessage.className = "message show error";
  }
}

function render() {
  const search = el.proxyWorkerSearch.value.trim().toLowerCase();
  const visible = workers.filter(worker =>
    !search || `${worker.name || ""} ${worker.employeeNumber || ""}`.toLowerCase().includes(search)
  );
  el.proxyWorkerTableBody.replaceChildren();
  el.proxyWorkerCards.replaceChildren();
  visible.forEach(worker => {
    const row = document.createElement("tr");
    const station = currentRole.role === "admin" && effectiveBranchId(currentRole) === ALL_BRANCHES
      ? `${worker.nearestStation || "―"} / ${branchName(worker.branchId)}`
      : worker.nearestStation || "―";
    [worker.employeeNumber, worker.name, station].forEach(value => {
      const cell = document.createElement("td");
      cell.textContent = value;
      row.appendChild(cell);
    });
    const action = document.createElement("td");
    action.appendChild(proxyButton(worker));
    row.appendChild(action);
    el.proxyWorkerTableBody.appendChild(row);

    const card = document.createElement("article");
    card.className = "guard-management-card";
    const name = document.createElement("strong");
    name.textContent = worker.name;
    const details = document.createElement("div");
    details.className = "guard-card-details";
    details.textContent = `警備員番号：${worker.employeeNumber}\n最寄り駅：${worker.nearestStation || "―"}`;
    card.append(name, details, proxyButton(worker));
    el.proxyWorkerCards.appendChild(card);
  });
  if (!visible.length) {
    const row = document.createElement("tr");
    row.innerHTML = '<td colspan="4">該当する編集対象者はいません</td>';
    el.proxyWorkerTableBody.appendChild(row);
    const empty = document.createElement("div");
    empty.className = "panel";
    empty.textContent = "該当する編集対象者はいません";
    el.proxyWorkerCards.appendChild(empty);
  }
}

function proxyButton(worker) {
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = "勤務希望を編集";
  button.addEventListener("click", () => openCalendar(worker, "proxyWorkers"));
  return button;
}
