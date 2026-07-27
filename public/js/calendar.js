import { getAvailability, saveAvailability } from "./availability.js";

const HOLIDAYS_2026 = {
  "2026-01-01": "元日", "2026-01-12": "成人の日", "2026-02-11": "建国記念の日",
  "2026-02-23": "天皇誕生日", "2026-03-20": "春分の日", "2026-04-29": "昭和の日",
  "2026-05-03": "憲法記念日", "2026-05-04": "みどりの日", "2026-05-05": "こどもの日",
  "2026-05-06": "振替休日", "2026-07-20": "海の日", "2026-08-11": "山の日",
  "2026-09-21": "敬老の日", "2026-09-22": "国民の休日", "2026-09-23": "秋分の日",
  "2026-10-12": "スポーツの日", "2026-11-03": "文化の日", "2026-11-23": "勤労感謝の日"
};

const state = {
  viewDate: new Date(),
  selectedDate: "",
  draft: emptyAvailability(),
  profile: null
};
let el;
let notify;
let confirmedByDate = new Map();

export function setConfirmedShifts(items = []) {
  confirmedByDate = new Map(items.map(item => [item.date, item]));
}

export function initCalendar(elements, showToast) {
  el = elements;
  notify = showToast;
  el.prevMonthButton.addEventListener("click", () => moveMonth(-1));
  el.nextMonthButton.addEventListener("click", () => moveMonth(1));
  el.todayButton.addEventListener("click", () => { state.viewDate = new Date(); renderCalendar(); });
  el.closeShiftButton.addEventListener("click", closeModal);
  el.shiftModalBackdrop.addEventListener("click", event => {
    if (event.target === el.shiftModalBackdrop) closeModal();
  });
  el.choiceDay.addEventListener("click", () => toggleDraft("day"));
  el.choiceNight.addEventListener("click", () => toggleDraft("night"));
  el.choiceUnavailable.addEventListener("click", () => toggleDraft("unavailable"));
  el.choiceUndecided.addEventListener("click", () => toggleDraft("undecided"));
  el.saveShiftButton.addEventListener("click", save);
  document.addEventListener("keydown", event => {
    if (event.key === "Escape" && el.shiftModalBackdrop.classList.contains("show")) closeModal();
  });
}

export function showCalendar(profile) {
  state.profile = profile;
  state.viewDate = new Date();
  el.currentUserName.textContent = profile.name;
  el.currentUserId.textContent = profile.employeeNumber;
  renderCalendar();
}

export function renderCalendar() {
  if (!el || !state.profile) return;
  const year = state.viewDate.getFullYear();
  const month = state.viewDate.getMonth();
  el.monthLabel.textContent = `${year}年${month + 1}月`;
  el.calendarGrid.replaceChildren();

  const first = new Date(year, month, 1);
  const last = new Date(year, month + 1, 0);
  for (let index = 0; index < first.getDay(); index += 1) {
    const blank = document.createElement("div");
    blank.className = "day-cell blank";
    el.calendarGrid.appendChild(blank);
  }

  for (let day = 1; day <= last.getDate(); day += 1) {
    const date = new Date(year, month, day);
    const dateKey = toDateKey(date);
    const cell = document.createElement("div");
    cell.className = "day-cell";
    if (date.getDay() === 0 || HOLIDAYS_2026[dateKey]) cell.classList.add("sunday");
    if (date.getDay() === 6) cell.classList.add("saturday");

    const button = document.createElement("button");
    button.type = "button";
    button.className = "day-button";
    button.setAttribute("aria-label", `${formatDateLong(dateKey)}の勤務希望を編集`);
    button.addEventListener("click", () => openModal(dateKey));

    const dateNumber = document.createElement("span");
    dateNumber.className = "date-number";
    dateNumber.textContent = String(day);
    button.appendChild(dateNumber);
    if (HOLIDAYS_2026[dateKey]) {
      const holiday = document.createElement("span");
      holiday.className = "holiday-name";
      holiday.textContent = HOLIDAYS_2026[dateKey];
      button.appendChild(holiday);
    }

    const confirmed = confirmedByDate.get(dateKey);
    const status = confirmed ? { key: "confirmed", label: "確定" } : getStatus(getAvailability(dateKey));
    const chip = document.createElement("span");
    chip.className = `status-chip status-${status.key}`;
    chip.textContent = status.label;
    button.appendChild(chip);

    const lock = getLockState(dateKey);
    if (lock.dayLocked || lock.nightLocked || isPastDate(dateKey)) {
      const locked = document.createElement("span");
      locked.className = "deadline-mini";
      locked.textContent = lockMessageShort(lock);
      button.appendChild(locked);
    }
    cell.appendChild(button);
    el.calendarGrid.appendChild(cell);
  }
}

function openModal(dateKey) {
  state.selectedDate = dateKey;
  state.draft = normalizeAvailability(getAvailability(dateKey));
  el.modalTitle.textContent = `${formatDateLong(dateKey)}の勤務希望`;
  const confirmed = confirmedByDate.get(dateKey);
  el.confirmedShiftDetails.hidden = !confirmed;
  if (confirmed) el.confirmedShiftDetails.textContent = `${confirmed.title}\n${confirmed.clientName}\n${confirmed.address}\n集合：${confirmed.meetingPlace || "―"} ${confirmed.meetingTime}\n勤務：${confirmed.startTime}～${confirmed.endTime}\n役割：${confirmed.leaderUid === state.profile.uid ? "隊長" : "隊員"}`;
  el.shiftNote.value = state.draft.note;
  const lock = getLockState(dateKey);
  const past = isPastDate(dateKey);
  el.modalLockNote.hidden = !(past || lock.dayLocked || lock.nightLocked);
  el.modalLockNote.textContent = past ? "過去の日付は変更できません。" : lockMessageFull(lock);
  el.shiftNote.disabled = past || (lock.dayLocked && lock.nightLocked);
  el.saveShiftButton.disabled = past || (lock.dayLocked && lock.nightLocked);
  updateChoiceButtons();
  el.shiftModalBackdrop.classList.add("show");
}

function closeModal() {
  el.shiftModalBackdrop.classList.remove("show");
}

function toggleDraft(kind) {
  const lock = getLockState(state.selectedDate);
  if (isPastDate(state.selectedDate)) return;
  if ((kind === "day" && lock.dayLocked) || (kind === "night" && lock.nightLocked)) return;
  if ((kind === "unavailable" || kind === "undecided") && (lock.dayLocked || lock.nightLocked)) return;

  if (kind === "unavailable" || kind === "undecided") {
    const nextValue = !state.draft[kind];
    state.draft = emptyAvailability();
    state.draft[kind] = nextValue;
  } else {
    state.draft[kind] = !state.draft[kind];
    state.draft.unavailable = false;
    state.draft.undecided = false;
  }
  updateChoiceButtons();
}

function updateChoiceButtons() {
  const lock = getLockState(state.selectedDate);
  const past = isPastDate(state.selectedDate);
  const pairs = [
    [el.choiceDay, "day", past || lock.dayLocked],
    [el.choiceNight, "night", past || lock.nightLocked],
    [el.choiceUnavailable, "unavailable", past || lock.dayLocked || lock.nightLocked],
    [el.choiceUndecided, "undecided", past || lock.dayLocked || lock.nightLocked]
  ];
  pairs.forEach(([button, key, disabled]) => {
    button.classList.toggle("selected", state.draft[key]);
    button.setAttribute("aria-pressed", String(state.draft[key]));
    button.disabled = disabled;
  });
  el.choiceDay.textContent = lock.dayLocked ? "日勤 締切済み" : "日勤を希望する";
  el.choiceNight.textContent = lock.nightLocked ? "夜勤 締切済み" : "夜勤を希望する";
}

async function save() {
  const lock = getLockState(state.selectedDate);
  if (isPastDate(state.selectedDate) || (lock.dayLocked && lock.nightLocked)) return;
  const existing = normalizeAvailability(getAvailability(state.selectedDate));
  const next = normalizeAvailability({ ...state.draft, note: el.shiftNote.value });
  if (lock.dayLocked) next.day = existing.day;
  if (lock.nightLocked) next.night = existing.night;
  el.saveShiftButton.disabled = true;
  try {
    await saveAvailability(state.profile.uid, state.selectedDate, next, state.profile.branchId);
    closeModal();
    renderCalendar();
    notify("勤務希望を保存しました。");
  } catch (error) {
    console.error(error);
    notify("保存できませんでした。通信状態を確認してください。");
  } finally {
    el.saveShiftButton.disabled = false;
  }
}

function emptyAvailability() {
  return { day: false, night: false, unavailable: false, undecided: false, note: "" };
}

function normalizeAvailability(value) {
  return { ...emptyAvailability(), ...(value || {}) };
}

function getStatus(value) {
  const item = normalizeAvailability(value);
  if (item.unavailable) return { key: "unavailable", label: "不可" };
  if (item.undecided) return { key: "undecided", label: "未定" };
  if (item.day && item.night) return { key: "both", label: "日夜" };
  if (item.day) return { key: "day", label: "日勤" };
  if (item.night) return { key: "night", label: "夜勤" };
  return { key: "none", label: "未入力" };
}

export function getLockState(dateKey, now = new Date()) {
  const workDate = parseDateKey(dateKey);
  return {
    dayLocked: now >= new Date(workDate.getFullYear(), workDate.getMonth(), workDate.getDate() - 1, 0, 0, 0),
    nightLocked: now >= new Date(workDate.getFullYear(), workDate.getMonth(), workDate.getDate() - 1, 12, 0, 0)
  };
}

function lockMessageShort(lock) {
  if (lock.dayLocked || lock.nightLocked) return "締切";
  return "";
}

function lockMessageFull(lock) {
  if (lock.dayLocked && lock.nightLocked) return "日勤・夜勤ともに締切済みです。";
  if (lock.dayLocked) return "日勤は前日0時で締め切りました。夜勤のみ変更できます。";
  if (lock.nightLocked) return "夜勤は前日12時で締め切りました。";
  return "";
}

function isPastDate(dateKey) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return parseDateKey(dateKey) < today;
}

function moveMonth(amount) {
  state.viewDate = new Date(state.viewDate.getFullYear(), state.viewDate.getMonth() + amount, 1);
  renderCalendar();
}

export function toDateKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function parseDateKey(dateKey) {
  const [year, month, day] = dateKey.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function formatDateLong(dateKey) {
  const date = parseDateKey(dateKey);
  const holiday = HOLIDAYS_2026[dateKey] ? `・${HOLIDAYS_2026[dateKey]}` : "";
  return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日（${"日月火水木金土"[date.getDay()]}）${holiday}`;
}
