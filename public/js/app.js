import { loadOwnProfile, loginWithEmployeeNumber, logout, observeAuthState, observeOwnRole, registerGuard } from "./auth.js?v=20260722-3";
import { clearAvailabilityCache, loadOwnAvailability } from "./availability.js?v=20260730-2";
import { initCalendar, setConfirmedShifts, showCalendar } from "./calendar.js?v=20260730-2";
import { initAdmin, loadStaffRequests, reviewStaffRequest, showAdmin } from "./admin.js?v=20260730-3";
import { initShifts, loadOwnConfirmedShifts } from "./shifts.js?v=20260730-3";
import { createIntegratedWorkerMenu, initGuardManagement, setGuardManagementContext, showGuardManagement } from "./guard-management.js?v=20260730-5";
import { initProxyInput, showProxyWorkerList } from "./proxy-input.js?v=20260730-1";
import { initShiftConfirmation, showOwnShifts } from "./shift-confirmation.js?v=20260730-3";
import { initShiftProgress, showDailyProgress } from "./shift-progress.js?v=20260730-2";

const el = {};
let toastTimer;
let profile;
let roleData;
let stopRoleObserver;
let registrationInProgress = false;
let showShiftBuilder;
let pendingWebProxyResolve;

document.addEventListener("DOMContentLoaded", () => {
  cacheElements();
  initAdmin(el, showScreen, createIntegratedWorkerMenu);
  initCalendar(el, showToast);
  showShiftBuilder = initShifts(el, showScreen, showToast);
  initGuardManagement(el, showScreen, showToast, openProxyCalendar, () => showAdmin(profile, roleData));
  initProxyInput(el, showScreen, openProxyCalendar);
  initShiftConfirmation(el, showScreen);
  initShiftProgress(el, showScreen, showToast);
  bindEvents();
  observeAuthState(handleAuthState);
});

function cacheElements() {
  ["loginScreen","registerScreen","calendarScreen","adminScreen","staffRequestsScreen","guardManagementScreen","deletedAccountsScreen","proxyWorkerScreen","ownShiftsScreen","dailyProgressScreen",
   "loginMessage","registerMessage","loginEmployeeNumber","loginPassword","loginButton",
   "showRegisterButton","forgotPasswordButton","regGuardId","regName","regEmail","regZip",
   "regPref","regCity","regStreet","regBuilding","regNearestStation","regPassword",
   "regPasswordConfirm","regStaffRequested","staffRequestFields","regStaffName","regStaffBranch",
   "registerButton","backLoginButton","currentUserName","currentUserId","proxyInputBanner","proxyInputTitle","proxyInputEmployeeNumber","proxyInputName","proxyInputMode","proxyInputWarning","exitProxyInputButton",
   "prevMonthButton","nextMonthButton","todayButton","monthLabel","calendarGrid","openAdminButton",
   "adminDateLabel","adminDate","adminSearch","adminSearchButton","adminClearButton","adminFilters",
   "adminTableBody","adminCards","adminPrevDay","adminToday","adminNextDay",
   "menuButton","requestsMenuButton","guardManagementMenuButton","deletedAccountsMenuButton","proxyWorkerMenuButton","ownShiftsMenuButton","dailyProgressMenuButton","sideMenuBackdrop","sideMenu","closeMenuButton",
   "menuAdminButton","menuCalendarButton","menuOwnShiftsButton","menuDailyProgressButton","menuRequestsButton","menuLogoutButton",
   "guardManagementMessage","newManagedGuardButton","openDeletedAccountsButton","backToGuardManagementButton","guardManagementSearch","guardManagementTableBody","guardManagementCards",
   "deletedAccountsMessage","deletedAccountsTableBody","deletedAccountsCards","accountStatusConfirmModal","accountStatusConfirmTitle","accountStatusConfirmMessage","confirmAccountStatusButton","cancelAccountStatusButton",
   "managedGuardModal","managedGuardModalTitle","managedGuardFormMessage","managedGuardEmployeeNumber","managedGuardName","managedGuardPhone",
   "managedGuardPostalCode","managedGuardPrefecture","managedGuardCity","managedGuardAddressLine","managedGuardBuilding",
   "managedGuardNearestStation","managedGuardContactEmailLabel","managedGuardContactEmail","saveManagedGuardButton","cancelManagedGuardButton",
   "managedGuardFixedInputMode","managedGuardFixedRole","managedGuardFixedStatus",
   "webProfileEditConfirmModal","webProfileEditConfirmMessage","cancelWebProfileEditButton","confirmWebProfileEditButton",
   "profileSaveConfirmModal","profileSaveConfirmMessage","cancelProfileSaveButton","confirmProfileSaveButton",
   "webProxyConfirmModal","webProxyConfirmMessage","cancelWebProxyButton","startWebProxyButton",
   "proxyReasonModal","proxyReasonStep","proxyConfirmStep","proxyUpdateReason","proxyUpdateReasonNoteWrap","proxyUpdateReasonNote","proxyReasonMessage","cancelProxyReasonButton","continueProxyReasonButton","proxySaveConfirmation","backProxyReasonButton","confirmProxySaveButton",
   "staffRequestsList","staffRequestsMessage","shiftBuilderScreen","shiftBuilderMenuButton","menuShiftBuilderButton",
   "proxyWorkerMessage","proxyWorkerSearch","proxyWorkerTableBody","proxyWorkerCards",
   "ownShiftsMessage","ownShiftsList","ownShiftDetailModal","ownShiftDetailTitle","ownShiftDetailBody","closeOwnShiftDetailButton",
   "shiftMembersModal","shiftMembersTitle","shiftMembersSummary","shiftMembersList","closeShiftMembersButton",
   "dailyProgressMessage","progressDate","progressShiftType","progressFilters","dailyProgressTableBody","dailyProgressCards",
   "departureTimeModal","departureTimeInput","departureTimeMessage","cancelDepartureTimeButton","confirmDepartureTimeButton",
   "shiftPrevDay","shiftNextDay","shiftToday","shiftBuilderDate","shiftTypeDay","shiftTypeNight","shiftBuilderMessage","shiftGroupsList","newShiftGroupButton",
   "shiftGroupModal","shiftGroupModalTitle","shiftGroupTitle","shiftAddress","shiftStartHour","shiftStartMinute","shiftDepartureCheckTime","shiftRequiredMembers","requiredMembersPickerButton","requiredMembersOptions","shiftGroupNote","memberSearch","memberCandidatesToggle","memberCandidates","showOutsideAvailability","selectedMembersList","leaderChoices","clearLeaderButton","groupCompletionMessage","draftShiftTopButton","confirmShiftTopButton","closeShiftGroupTopButton","draftShiftButton","confirmShiftButton","closeShiftGroupButton","availabilityNotePanel","closeAvailabilityNotePanel","availabilityNoteFullText",
   "shiftDateActionModal","shiftDateActionTitle","shiftDateActionHelp","shiftDateActionInput","shiftDateActionError","saveShiftDateActionButton","cancelShiftDateActionButton",
   "shiftOperationConfirmModal","shiftOperationConfirmTitle","shiftOperationConfirmMessage","confirmShiftOperationButton","cancelShiftOperationButton",
   "shiftModalBackdrop","modalTitle","modalLockNote","confirmedShiftDetails",
   "choiceDay","choiceNight","choiceUnavailable","choiceUndecided","shiftNote","saveShiftButton",
   "closeShiftButton","toast"].forEach(id => { el[id] = document.getElementById(id); });
}

function bindEvents() {
  el.loginButton.addEventListener("click", login);
  el.loginPassword.addEventListener("keydown", event => { if (event.key === "Enter") login(); });
  el.showRegisterButton.addEventListener("click", () => showScreen("register"));
  el.backLoginButton.addEventListener("click", () => showScreen("login"));
  el.forgotPasswordButton.addEventListener("click", () =>
    showMessage(el.loginMessage, "パスワードを忘れた場合は、国分寺支社の内勤者へ連絡してください。", false));
  el.regStaffRequested.addEventListener("change", () => {
    el.staffRequestFields.hidden = !el.regStaffRequested.checked;
    if (el.regStaffRequested.checked && !el.regStaffName.value) el.regStaffName.value = el.regName.value;
  });
  el.registerButton.addEventListener("click", register);
  el.openAdminButton.addEventListener("click", openMenu);
  [el.menuButton, el.requestsMenuButton, el.shiftBuilderMenuButton, el.guardManagementMenuButton, el.deletedAccountsMenuButton, el.proxyWorkerMenuButton, el.ownShiftsMenuButton, el.dailyProgressMenuButton]
    .forEach(button => button.addEventListener("click", openMenu));
  el.closeMenuButton.addEventListener("click", closeMenu);
  el.sideMenuBackdrop.addEventListener("click", event => { if (event.target === el.sideMenuBackdrop) closeMenu(); });
  document.addEventListener("keydown", event => {
    if (event.key !== "Escape") return;
    closeMenu();
    if (el.webProxyConfirmModal.classList.contains("show")) closeWebProxyConfirm(false);
  });
  el.menuAdminButton.addEventListener("click", async () => { closeMenu(); await showAdmin(profile, roleData); });
  el.menuShiftBuilderButton.addEventListener("click", async () => { closeMenu(); await showShiftBuilder(profile, roleData); });
  el.menuOwnShiftsButton.addEventListener("click", () => {
    closeMenu();
    showOwnShifts(profile);
  });
  el.menuDailyProgressButton.addEventListener("click", async () => {
    closeMenu();
    await showDailyProgress(profile, roleData);
  });
  el.menuCalendarButton.addEventListener("click", async () => {
    closeMenu(); await loadOwnAvailability(profile.uid); showScreen("calendar"); showCalendar(profile);
  });
  el.menuRequestsButton.addEventListener("click", async () => { closeMenu(); await showRequests(); });
  el.menuLogoutButton.addEventListener("click", signOutUser);
  el.cancelWebProxyButton.addEventListener("click", () => closeWebProxyConfirm(false));
  el.startWebProxyButton.addEventListener("click", () => closeWebProxyConfirm(true));
  el.webProxyConfirmModal.addEventListener("click", event => {
    if (event.target === el.webProxyConfirmModal) closeWebProxyConfirm(false);
  });
}

async function handleAuthState(user) {
  if (registrationInProgress) return;
  stopRoleObserver?.();
  clearAvailabilityCache();
  if (!user) { profile = null; roleData = null; showScreen("login"); return; }
  try {
    profile = await loadOwnProfile(user);
    stopRoleObserver = observeOwnRole(user.uid, nextRole => handleRoleChange(nextRole), async error => {
      console.error(error); await signOutUser();
    });
  } catch (error) {
    console.error(error); await signOutUser();
    showMessage(el.loginMessage, "利用者情報を読み込めませんでした。", true);
  }
}

async function handleRoleChange(nextRole) {
  if (!nextRole || nextRole.accountStatus !== "active") {
    await signOutUser();
    showMessage(el.loginMessage, "このアカウントは現在利用できません。国分寺支社へお問い合わせください。", true);
    return;
  }
  roleData = nextRole;
  setGuardManagementContext(profile, roleData);
  const isOffice = ["staff", "admin"].includes(roleData.role);
  el.openAdminButton.hidden = false;
  el.menuAdminButton.hidden = !isOffice;
  el.menuShiftBuilderButton.hidden = !isOffice;
  el.menuRequestsButton.hidden = !isOffice;
  el.menuDailyProgressButton.hidden = !isOffice;
  el.menuCalendarButton.textContent = isOffice ? "自分の勤務希望" : "勤務希望入力";
  el.menuOwnShiftsButton.textContent = isOffice ? "自分のシフト" : "シフト確認";
  if (isOffice) await showAdmin(profile, roleData);
  else {
    await loadOwnAvailability(profile.uid);
    setConfirmedShifts(await loadOwnConfirmedShifts(profile.uid, profile.branchId));
    showScreen("calendar");
    showCalendar(profile);
  }
}

async function login() {
  const employeeNumber = el.loginEmployeeNumber.value.trim();
  const password = el.loginPassword.value;
  if (!/^\d{6}$/.test(employeeNumber) || !password) {
    showMessage(el.loginMessage, "警備員番号またはパスワードが正しくありません。", true); return;
  }
  await runButtonTask(el.loginButton, async () => {
    try { await loginWithEmployeeNumber(employeeNumber, password); }
    catch { showMessage(el.loginMessage, "警備員番号またはパスワードが正しくありません。", true); }
  });
}

async function register() {
  const form = {
    employeeNumber: el.regGuardId.value.trim(), name: el.regName.value.trim(),
    email: el.regEmail.value.trim(), postalCode: el.regZip.value.replace(/\D/g, ""),
    prefecture: el.regPref.value.trim(), city: el.regCity.value.trim(),
    addressLine: el.regStreet.value.trim(), building: el.regBuilding.value.trim(),
    nearestStation: el.regNearestStation.value.trim(), password: el.regPassword.value,
    staffRequested: el.regStaffRequested.checked,
    staffRequestName: el.regStaffName.value.trim(), staffRequestBranch: el.regStaffBranch.value.trim()
  };
  const errors = validateRegistration(form, el.regPasswordConfirm.value);
  if (errors.length) { showMessage(el.registerMessage, errors.join(" / "), true); return; }
  await runButtonTask(el.registerButton, async () => {
    registrationInProgress = true;
    try {
      const user = await registerGuard(form);
      registrationInProgress = false;
      await handleAuthState(user);
      showToast("登録しました。");
    }
    catch (error) {
      registrationInProgress = false;
      console.error(error);
      showMessage(el.registerMessage, "登録できませんでした。警備員番号が既に使われている可能性があります。", true);
    }
  });
}

function validateRegistration(form, confirmation) {
  const errors = [];
  if (!/^\d{6}$/.test(form.employeeNumber)) errors.push("警備員番号は6桁で入力してください");
  if (!form.name || form.name.length > 80) errors.push("氏名を80文字以内で入力してください");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) errors.push("正しい連絡用メールアドレスを入力してください");
  if (!/^\d{7}$/.test(form.postalCode)) errors.push("郵便番号は7桁で入力してください");
  if (!form.prefecture || !form.city || !form.addressLine) errors.push("住所を入力してください");
  if (form.password.length < 6) errors.push("パスワードは6文字以上で入力してください");
  if (form.password !== confirmation) errors.push("パスワードが一致していません");
  if (form.staffRequested && (!form.staffRequestName || !form.staffRequestBranch)) errors.push("内勤者申請の氏名と所属支社を入力してください");
  return errors;
}

async function showRequests() {
  showScreen("requests");
  el.staffRequestsList.replaceChildren();
  try {
    const requests = await loadStaffRequests();
    requests.forEach(item => {
      const card = document.createElement("article");
      card.className = "request-card";
      const date = item.createdAt?.toDate?.().toLocaleString("ja-JP") || "―";
      card.innerHTML = `<div><b>警備員番号：</b>${escapeHtml(item.employeeNumber)}</div>
        <div><b>氏名：</b>${escapeHtml(item.name)}</div><div><b>所属支社：</b>${escapeHtml(item.branchId)}</div>
        <div><b>申請日時：</b>${escapeHtml(date)}</div><div><b>現在の状態：</b>${escapeHtml(item.status)}</div>`;
      if (item.status === "pending" && roleData?.role === "admin") {
        const actions = document.createElement("div"); actions.className = "request-actions";
        [["承認","approved"],["却下","rejected"]].forEach(([label, decision]) => {
          const button = document.createElement("button"); button.textContent = label;
          if (decision === "rejected") button.className = "secondary";
          button.addEventListener("click", async () => {
            button.disabled = true;
            try { await reviewStaffRequest(item, decision); await showRequests(); }
            catch (error) { console.error(error); showMessage(el.staffRequestsMessage, "処理できませんでした。", true); }
          });
          actions.appendChild(button);
        });
        card.appendChild(actions);
      }
      el.staffRequestsList.appendChild(card);
    });
    if (!requests.length) el.staffRequestsList.innerHTML = '<div class="panel">申請はありません。</div>';
  } catch (error) { console.error(error); showMessage(el.staffRequestsMessage, "申請を読み込めませんでした。", true); }
}

async function signOutUser() {
  closeMenu(); stopRoleObserver?.(); stopRoleObserver = null;
  await logout(); el.loginPassword.value = ""; showToast("ログアウトしました。");
}
function openMenu() { if (roleData?.accountStatus === "active") el.sideMenuBackdrop.classList.add("show"); }
function closeMenu() { el.sideMenuBackdrop.classList.remove("show"); }
function showScreen(name) {
  const screens = {login:el.loginScreen, register:el.registerScreen, calendar:el.calendarScreen,
    admin:el.adminScreen, requests:el.staffRequestsScreen, shiftBuilder:el.shiftBuilderScreen,
    guardManagement:el.guardManagementScreen, deletedAccounts:el.deletedAccountsScreen,
    proxyWorkers:el.proxyWorkerScreen, ownShifts:el.ownShiftsScreen, dailyProgress:el.dailyProgressScreen};
  Object.values(screens).forEach(screen => screen?.classList.remove("active"));
  screens[name]?.classList.add("active"); window.scrollTo({top:0, behavior:"smooth"});
}
async function openProxyCalendar(worker, returnScreen = "proxyWorkers") {
  if (!canProxyInput(worker)) return;
  const inputMode = worker.inputMode === "managed" ? "managed" : "web";
  if (inputMode === "web" && !await confirmWebProxyStart(worker)) return;
  try {
    await loadOwnAvailability(worker.id || worker.uid, worker.branchId || roleData.branchId);
  } catch (error) {
    console.error(error);
    showToast("代理入力画面を開けませんでした。Firestore Rulesのデプロイ状態を確認してください。");
    return;
  }
  setConfirmedShifts([]);
  showScreen("calendar");
  showCalendar({ ...worker, uid: worker.id || worker.uid }, {
    proxy: true,
    operatorUid: profile.uid,
    operatorRole: roleData.role,
    inputMode,
    returnAction: async () => {
      if (returnScreen === "guardManagement") await showGuardManagement(profile, roleData);
      else if (returnScreen === "admin") await showAdmin(profile, roleData);
      else await showProxyWorkerList(profile, roleData);
    }
  });
}
function canProxyInput(worker) {
  const workerUid = worker?.id || worker?.uid;
  const inputMode = worker?.inputMode === "managed" ? "managed" : "web";
  return ["staff", "admin"].includes(roleData?.role) &&
    ["managed", "web"].includes(inputMode) &&
    worker?.accountStatus === "active" &&
    worker?.branchId === roleData.branchId &&
    workerUid !== profile?.uid &&
    (roleData.role === "admin" || worker?.role !== "admin");
}
function confirmWebProxyStart(worker) {
  el.webProxyConfirmMessage.textContent =
    `この警備員は本人がWebから勤務希望を入力できます。\n` +
    `代理入力を行うと、本人が入力した内容を上書きする可能性があります。\n\n` +
    `本人から電話・対面などで変更依頼を受けていることを確認してください。\n\n` +
    `対象：\n警備員番号：${worker.employeeNumber}\n氏名：${worker.name}`;
  el.webProxyConfirmModal.classList.add("show");
  return new Promise(resolve => { pendingWebProxyResolve = resolve; });
}
function closeWebProxyConfirm(result) {
  el.webProxyConfirmModal.classList.remove("show");
  const resolve = pendingWebProxyResolve;
  pendingWebProxyResolve = null;
  resolve?.(result);
}
async function runButtonTask(button, task) { button.disabled=true; try { await task(); } finally { button.disabled=false; } }
function showMessage(target, text, error) { target.textContent=text; target.className=`message show ${error?"error":"success"}`; }
function showToast(text) { clearTimeout(toastTimer); el.toast.textContent=text; el.toast.classList.add("show");
  toastTimer=setTimeout(()=>el.toast.classList.remove("show"),3200); }
function escapeHtml(value) { const div=document.createElement("div"); div.textContent=String(value??""); return div.innerHTML; }
