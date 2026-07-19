import { db } from "./firebase-config.js";
import { collection, getDocs, query, where } from "https://www.gstatic.com/firebasejs/11.10.0/firebase-firestore.js";

let el;
let navigate;
let currentProfile;
let currentClaims;
let activeFilter = "all";

export function initAdmin(elements, showScreen) {
  el = elements;
  navigate = showScreen;
  const today = new Date().toISOString().slice(0, 10);
  el.adminDate.value = today;
  el.adminSearchButton.addEventListener("click", renderAdmin);
  el.adminClearButton.addEventListener("click", () => { el.adminSearch.value = ""; renderAdmin(); });
  el.adminDate.addEventListener("change", renderAdmin);
  el.adminPrevDay.addEventListener("click", () => moveDate(-1));
  el.adminToday.addEventListener("click", () => { el.adminDate.value = new Date().toISOString().slice(0, 10); renderAdmin(); });
  el.adminNextDay.addEventListener("click", () => moveDate(1));
  el.adminFilters.addEventListener("click", event => {
    const button = event.target.closest("button[data-filter]");
    if (!button) return;
    activeFilter = button.dataset.filter;
    el.adminFilters.querySelectorAll("button").forEach(item => item.classList.toggle("active", item === button));
    renderAdmin();
  });
}

export async function showAdmin(profile = currentProfile, claims = currentClaims) {
  if (profile) currentProfile = profile;
  if (claims) currentClaims = claims;
  if (!["staff", "admin"].includes(currentClaims?.role)) throw new Error("管理画面を開く権限がありません。");
  navigate("admin");
  await renderAdmin();
}

async function renderAdmin() {
  const branchId = currentClaims.branchId;
  const date = el.adminDate.value;
  el.adminDateLabel.textContent = `${date} の勤務希望`;
  const [usersSnapshot, availabilitySnapshot] = await Promise.all([
    getDocs(query(collection(db, "users"), where("branchId", "==", branchId))),
    getDocs(query(collection(db, "availability"), where("branchId", "==", branchId), where("date", "==", date)))
  ]);
  const availability = new Map(availabilitySnapshot.docs.map(d => [d.data().uid, d.data()]));
  const search = el.adminSearch.value.trim().toLowerCase();
  const rows = usersSnapshot.docs.map(d => ({ uid: d.id, ...d.data(), shift: availability.get(d.id) }))
    .filter(user => user.role === "guard")
    .filter(user => matchesFilter(user.shift))
    .filter(user => !search || `${user.employeeNumber} ${user.name} ${user.city}`.toLowerCase().includes(search));
  el.adminTableBody.replaceChildren();
  el.adminCards.replaceChildren();
  rows.forEach(user => {
    const shift = user.shift || {};
    const status = shift.unavailable ? "勤務不可" : shift.undecided ? "未定" :
      shift.day && shift.night ? "日勤・夜勤" : shift.day ? "日勤" : shift.night ? "夜勤" : "未入力";
    const values = [user.employeeNumber, user.name, shift.day ? "○" : "―", shift.night ? "○" : "―",
      status, shift.note || "", user.postalCode, `${user.prefecture}${user.city}${user.addressLine}${user.building || ""}`, user.email];
    const tr = document.createElement("tr");
    values.forEach(value => { const td = document.createElement("td"); td.textContent = value; tr.appendChild(td); });
    el.adminTableBody.appendChild(tr);
    const card = document.createElement("article");
    card.className = "admin-card";
    card.textContent = `${user.employeeNumber}　${user.name}\n${status}\n${shift.note || "備考なし"}`;
    el.adminCards.appendChild(card);
  });
  if (!rows.length) el.adminTableBody.innerHTML = '<tr><td colspan="9">該当する警備員はいません</td></tr>';
}

function moveDate(days) {
  const date = new Date(`${el.adminDate.value}T00:00:00`);
  date.setDate(date.getDate() + days);
  el.adminDate.value = date.toISOString().slice(0, 10);
  renderAdmin();
}

function matchesFilter(shift) {
  if (activeFilter === "all") return true;
  if (activeFilter === "none") return !shift;
  if (!shift) return false;
  if (activeFilter === "day") return shift.day;
  if (activeFilter === "night") return shift.night;
  if (activeFilter === "both") return shift.day && shift.night;
  if (activeFilter === "unavailable") return shift.unavailable;
  if (activeFilter === "undecided") return shift.undecided;
  return true;
}
