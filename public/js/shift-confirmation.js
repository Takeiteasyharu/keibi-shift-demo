import { db } from "./firebase-config.js";
import {
  collection,
  onSnapshot,
  query,
  where
} from "https://www.gstatic.com/firebasejs/11.10.0/firebase-firestore.js";

let el;
let navigate;
let currentProfile;
let unsubscribe = null;
let shifts = [];

export function initShiftConfirmation(elements, showScreen) {
  el = elements;
  navigate = showScreen;
  el.closeOwnShiftDetailButton.addEventListener("click", closeDetail);
  el.ownShiftDetailModal.addEventListener("click", event => {
    if (event.target === el.ownShiftDetailModal) closeDetail();
  });
  document.addEventListener("keydown", event => {
    if (event.key === "Escape" && el.ownShiftDetailModal.classList.contains("show")) closeDetail();
  });
}

export function showOwnShifts(profile) {
  currentProfile = profile;
  navigate("ownShifts");
  el.ownShiftsMessage.textContent = "確定シフトを読み込んでいます。";
  el.ownShiftsMessage.className = "message show";
  unsubscribe?.();
  const ownQuery = query(
    collection(db, "shiftGroups"),
    where("branchId", "==", profile.branchId),
    where("status", "==", "confirmed"),
    where("memberUids", "array-contains", profile.uid)
  );
  unsubscribe = onSnapshot(ownQuery, snapshot => {
    const today = toDateKey(new Date());
    shifts = snapshot.docs
      .map(item => ({ id: item.id, ...item.data() }))
      .filter(item => item.date >= today)
      .sort((a, b) => a.date.localeCompare(b.date) || String(a.startTime).localeCompare(String(b.startTime)));
    el.ownShiftsMessage.className = "message";
    render();
  }, error => {
    console.error(error);
    el.ownShiftsMessage.textContent = "シフトを読み込めませんでした。通信状態を確認してください。";
    el.ownShiftsMessage.className = "message show error";
  });
}

function render() {
  el.ownShiftsList.replaceChildren();
  if (!shifts.length) {
    const empty = document.createElement("div");
    empty.className = "own-shifts-empty";
    empty.textContent = "現在、確定しているシフトはありません。";
    el.ownShiftsList.appendChild(empty);
    return;
  }
  shifts.forEach((shift, index) => {
    const card = document.createElement("article");
    card.className = `own-shift-card shift-${shift.shiftType === "night" ? "night" : "day"}`;
    if (index === 0) {
      const next = document.createElement("div");
      next.className = "next-shift-label";
      next.textContent = "次回の勤務";
      card.appendChild(next);
    }
    const heading = document.createElement("div");
    heading.className = "own-shift-heading";
    const date = document.createElement("strong");
    date.textContent = formatDate(shift.date);
    const type = document.createElement("span");
    type.className = "own-shift-type";
    type.textContent = shift.shiftType === "night" ? "夜勤" : "日勤";
    heading.append(date, type);
    const title = document.createElement("h2");
    title.textContent = valueOrUnset(shift.title);
    const summary = document.createElement("div");
    summary.className = "own-shift-summary";
    summary.append(
      detailLine("現場", shift.address, "shift-address-value"),
      detailLine("勤務開始", shift.startTime),
      detailLine("役割", roleLabel(shift))
    );
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = "詳細を見る";
    button.addEventListener("click", () => openDetail(shift));
    card.append(heading, title, summary, button);
    el.ownShiftsList.appendChild(card);
  });
}

function openDetail(shift) {
  el.ownShiftDetailTitle.textContent = `${formatDate(shift.date)} ${shift.shiftType === "night" ? "夜勤" : "日勤"}`;
  el.ownShiftDetailBody.replaceChildren(
    detailLine("グループタイトル", shift.title),
    detailLine("得意先", shift.clientName),
    detailLine("現場", shift.address, "shift-address-value"),
    detailLine("集合場所", shift.meetingPlace),
    detailLine("集合時刻", shift.meetingTime),
    detailLine("勤務予定", timeRange(shift)),
    detailLine("役割", roleLabel(shift)),
    detailLine("備考", shift.note),
    detailLine("最終更新", formatTimestamp(shift.updatedAt))
  );
  el.ownShiftDetailModal.classList.add("show");
  requestAnimationFrame(() => el.closeOwnShiftDetailButton.focus());
}

function closeDetail() {
  el.ownShiftDetailModal.classList.remove("show");
}

function detailLine(label, value, valueClass = "") {
  const row = document.createElement("div");
  row.className = "own-shift-detail-row";
  const term = document.createElement("strong");
  term.textContent = `${label}：`;
  const content = document.createElement("span");
  content.className = valueClass;
  content.textContent = valueOrUnset(value);
  row.append(term, content);
  return row;
}

function roleLabel(shift) {
  return shift.leaderUid === currentProfile.uid ? "隊長" : "隊員";
}

function timeRange(shift) {
  const start = shift.startTime || "未設定";
  const end = shift.endTime || "未設定";
  return `${start} ～ ${end}`;
}

function valueOrUnset(value) {
  const text = String(value ?? "").trim();
  return text || "未設定";
}

function formatDate(dateKey) {
  const [year, month, day] = dateKey.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  return `${month}月${day}日（${"日月火水木金土"[date.getDay()]}）`;
}

function formatTimestamp(value) {
  const date = value?.toDate?.();
  if (!date) return "未設定";
  return `${date.getMonth() + 1}月${date.getDate()}日 ${String(date.getHours()).padStart(2, "0")}時${String(date.getMinutes()).padStart(2, "0")}分`;
}

function toDateKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
