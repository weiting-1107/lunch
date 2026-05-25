// --- Theme & Toast Logic ---
const theme = localStorage.getItem('lunch_theme') || 'light';
if (theme === 'dark') document.documentElement.setAttribute('data-theme', 'dark');

// --- 雲端配置與全域狀態 ---
const API_URL = "https://script.google.com/macros/s/AKfycbxR4hZVVCkYAWI-Gs_tvwN-q4mOwvYGrVMI3npR6CprPLBAmwR14HH1JuwGOpWZ1Hko/exec";
const CLOUD_CACHE_KEY = 'lunch_cloud_cache';
const SETTINGS_KEY = 'lunch_settings';

let isSyncing = false;
let lastSaveTimestamp = 0;
let memoryOrders = [];
let memoryUsers = [];
let memoryRestaurants = [];
let memoryVotes = [];
let memoryConfig = {};

let lastFetchID = 0;
let lastViewedMeal = '';
let lastViewedDate = '';
let currentUser = null;

function showToast(msg, type = 'success') {
    const container = document.getElementById('toast-container');
    if (!container) return;
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    const icon = type === 'success' ? '✅' : (type === 'error' ? '⚠️' : '💡');
    toast.innerHTML = `<span>${icon}</span> <span>${msg}</span>`;
    container.appendChild(toast);
    setTimeout(() => {
        toast.classList.add('diminish');
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

function showMenuLightbox(src, title) {
    let lightbox = document.getElementById('menu-lightbox');
    if (!lightbox) {
        lightbox = document.createElement('div');
        lightbox.id = 'menu-lightbox';
        lightbox.className = 'modal-overlay';
        lightbox.style.zIndex = '3000';
        lightbox.innerHTML = `
            <div class="modal-content" style="max-width:90%; max-height:90%; padding:1.5rem; position:relative; overflow:hidden; display:flex; flex-direction:column;">
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:1rem;">
                    <h3 id="lightbox-title" style="margin:0;"></h3>
                    <button id="close-lightbox" class="close-btn" style="background:none; border:none; font-size:1.5rem; cursor:pointer; color:var(--text-main);">✖</button>
                </div>
                <div style="overflow:auto; flex:1; display:flex; justify-content:center; align-items:flex-start;">
                    <img id="lightbox-img" src="" style="max-width:100%; display:block; border-radius:0.5rem; box-shadow:0 4px 20px rgba(0,0,0,0.3);">
                </div>
            </div>
        `;
        document.body.appendChild(lightbox);
        lightbox.querySelector('#close-lightbox').onclick = () => lightbox.classList.add('hidden');
        lightbox.onclick = (e) => { if (e.target === lightbox) lightbox.classList.add('hidden'); };
    }
    const titleEl = document.getElementById('lightbox-title');
    const imgEl = document.getElementById('lightbox-img');
    if (titleEl) titleEl.innerText = `📄 ${title} 的菜單`;
    if (imgEl) imgEl.src = src;
    lightbox.classList.remove('hidden');
}

function showSyncLoader() {
    document.body.classList.add('sync-active');
}
function hideSyncLoader() {
    document.body.classList.remove('sync-active');
}

document.addEventListener('DOMContentLoaded', () => {
    // --- 核心變數與元素定義 ---
    const appLayout = document.querySelector('.app-layout');
    const excelModal = document.getElementById('excel-modal');
    const settingsModal = document.getElementById('settings-modal');

    const dateInputs = document.querySelectorAll('#order-date, #order-date-mob');
    const mealTypeInputs = document.querySelectorAll('#meal-type, #meal-type-mob');
    const restaurantInputs = document.querySelectorAll('#restaurant-name, #restaurant-name-mob');
    const cutoffInputs = document.querySelectorAll('#cutoff-time, #cutoff-time-mob');

    const personNameInput = document.getElementById('person-name');
    const itemNameInput = document.getElementById('item-name');
    const itemPriceInput = document.getElementById('item-price');
    const submitOrderBtn = document.getElementById('submit-order-btn');

    const authNameInput = document.getElementById('auth-name');
    const authPassInput = document.getElementById('auth-pass');
    const authSubmitBtn = document.getElementById('auth-submit-btn');
    const authSwitchLink = document.getElementById('auth-switch-link');
    const loginTitle = document.getElementById('login-title');
    const loginSubtitle = document.getElementById('login-subtitle');
    const registerNote = document.getElementById('register-note');
    const loginOverlay = document.getElementById('login-overlay');

    let authMode = 'login';
    const orderFormContainer = document.getElementById('order-form-container');
    const lockedWarning = document.getElementById('locked-warning');

    const orderDateInput = document.getElementById('order-date');
    const mealTypeInput = document.getElementById('meal-type');
    const restaurantNameInput = document.getElementById('restaurant-name');
    const cutoffTimeInput = document.getElementById('cutoff-time');

    const currentWeekLabel = document.getElementById('current-week-label');
    let tabBtns = document.querySelectorAll('.tab-btn');
    let currentActiveTab = 'tab-details';
    let currentViewDate = new Date();
    let isSettingsAuthenticated = false;

    const prevWeekBtn = document.getElementById('prev-week-btn');
    const nextWeekBtn = document.getElementById('next-week-btn');
    const currentWeekBtn = document.getElementById('current-week-btn');
    const exportCsvBtn = document.getElementById('export-csv-btn');
    const clearHistoryBtn = document.getElementById('clear-history-btn');

    window.openMenuViewer = function (restName) {
        const modal = document.getElementById('menu-viewer-modal');
        const img = document.getElementById('menu-viewer-img');
        const title = document.getElementById('menu-viewer-title');
        const empty = document.getElementById('menu-viewer-empty');
        if (!modal || !img) return;
        const restaurant = memoryRestaurants.find(r => r && r.name && r.name.trim() === restName.trim());
        const imgData = restaurant ? (restaurant.menuImage || restaurant.menuUrl) : null;
        if (imgData) {
            title.textContent = `🍱 ${restaurant ? restaurant.name : restName} - 菜單`;
            img.src = imgData;
            img.classList.remove('hidden');
            empty.classList.add('hidden');
        } else {
            title.textContent = `🍱 ${restaurant ? restaurant.name : restName}`;
            img.src = "";
            img.classList.add('hidden');
            empty.textContent = "⚠️ 此餐廳目前無菜單圖片或連結";
            empty.classList.remove('hidden');
        }
        const closeBtn = modal.querySelector('.modal-close-btn');
        if (closeBtn) closeBtn.innerHTML = '✕';
        modal.classList.remove('hidden');
    };

    window.closeMenuViewer = function () {
        const modal = document.getElementById('menu-viewer-modal');
        if (modal) modal.classList.add('hidden');
    };

    const quickOrderLabels = document.getElementById('quick-order-labels');
    const activeRestCard = document.getElementById('active-restaurant-card');
    const displayRestName = document.getElementById('display-rest-name');
    const displayRestMenu = document.getElementById('display-rest-menu');
    const displayRestPhone = document.getElementById('display-rest-phone');
    const itemHistoryDl = document.getElementById('item-history');

    function safeListen(el, event, cb) { if (el) el.addEventListener(event, cb); }
    function safeListenAll(selector, event, cb) { document.querySelectorAll(selector).forEach(el => el.addEventListener(event, cb)); }

    function syncAndRefresh(inputs, val, refresh = true) {
        inputs.forEach(input => { if (input.value !== val) input.value = val; });
        if (refresh) {
            handleFormState();
            if (typeof updateRestaurantMenuDisplay === 'function') updateRestaurantMenuDisplay();
        }
    }

    function updateDashboardSafely(stats) {
        const elTodayCount = document.getElementById('dash-today-count');
        const elTodayTotal = document.getElementById('dash-today-total');
        const elGrandTotal = document.getElementById('dash-grand-total');
        if (elTodayCount) elTodayCount.innerText = stats.count || 0;
        if (elTodayTotal) elTodayTotal.innerText = stats.total || 0;
        if (elGrandTotal) elGrandTotal.innerText = stats.grandTotal || '$0';
    }

    dateInputs.forEach(el => safeListen(el, 'change', (e) => syncAndRefresh(dateInputs, e.target.value)));
    mealTypeInputs.forEach(el => safeListen(el, 'change', (e) => syncAndRefresh(mealTypeInputs, e.target.value)));
    restaurantInputs.forEach(el => safeListen(el, 'change', (e) => syncAndRefresh(restaurantInputs, e.target.value)));
    safeListenAll('.nav-home-btn', 'click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));

    function highlightTab(tabName) {
        currentActiveTab = tabName;
        const allReportTabs = document.querySelectorAll('.tab-btn');
        allReportTabs.forEach(b => {
            if (b.getAttribute('data-tab') === tabName) b.classList.add('active');
            else b.classList.remove('active');
        });
    }

    safeListenAll('.nav-details-btn', 'click', () => {
        highlightTab('tab-details');
        excelModal.classList.remove('hidden');
        renderOrders();
    });

    safeListenAll('.nav-person-btn', 'click', () => {
        highlightTab('tab-person');
        excelModal.classList.remove('hidden');
        renderOrders();
    });

    safeListenAll('.nav-settings-btn', 'click', () => {
        if (!settingsModal) return;
        isSettingsAuthenticated = true;
        document.getElementById('settings-auth-wrapper').style.display = 'none';
        document.getElementById('settings-main-content').style.display = 'block';
        settingsModal.classList.remove('hidden');
        renderSettingsTab();
    });

    const unlockSettings = () => {
        const input = document.getElementById('settings-password-input');
        const errorMsg = document.getElementById('auth-error-msg');
        const corePassword = String(memoryConfig.adminPwd || '1234');
        if (input.value === corePassword) {
            isSettingsAuthenticated = true;
            document.getElementById('settings-auth-wrapper').style.display = 'none';
            document.getElementById('settings-main-content').style.display = 'block';
            renderSettingsTab();
        } else {
            errorMsg.style.display = 'block';
            input.value = '';
            input.focus();
        }
    };

    safeListen(document.getElementById('unlock-settings-btn'), 'click', unlockSettings);
    safeListen(document.getElementById('settings-password-input'), 'keypress', (e) => { if (e.key === 'Enter') unlockSettings(); });

    const updateThemeIcons = (isDark) => {
        document.querySelectorAll('.theme-toggle').forEach(btn => {
            btn.innerHTML = isDark ? '<span>☀️</span>' : '<span>🌙</span>';
        });
    };
    updateThemeIcons(document.documentElement.getAttribute('data-theme') === 'dark');

    safeListenAll('.theme-toggle', 'click', () => {
        const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
        if (isDark) {
            document.documentElement.removeAttribute('data-theme');
            localStorage.setItem('lunch_theme', 'light');
            updateThemeIcons(false);
        } else {
            document.documentElement.setAttribute('data-theme', 'dark');
            localStorage.setItem('lunch_theme', 'dark');
            updateThemeIcons(true);
        }
    });

    safeListen(document.getElementById('close-modal-btn'), 'click', () => excelModal.classList.add('hidden'));
    safeListen(document.getElementById('close-settings-btn'), 'click', () => settingsModal.classList.add('hidden'));

    function normalizeDate(raw) {
        if (!raw) return '';
        if (typeof raw === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
        try {
            const d = new Date(raw);
            if (!isNaN(d.getTime())) {
                const local = new Date(d.getTime() + 8 * 60 * 60 * 1000);
                return `${local.getUTCFullYear()}-${String(local.getUTCMonth() + 1).padStart(2, '0')}-${String(local.getUTCDate()).padStart(2, '0')}`;
            }
        } catch (e) { }
        return String(raw);
    }

    function normalizeTime(raw) {
        if (!raw) return '';
        const str = String(raw);
        if (/^\d{2}:\d{2}$/.test(str)) return str;
        const isoMatch = String(str).match(/T(\d{2}):(\d{2})/);
        if (isoMatch) return `${isoMatch[1]}:${isoMatch[2]}`;
        try {
            const d = new Date(str);
            if (!isNaN(d.getTime())) return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
        } catch (e) { }
        const match = String(str).match(/(\d{1,2}):(\d{2})/);
        if (match) return `${match[1].padStart(2, '0')}:${match[2]}`;
        return '';
    }

    async function fetchFromCloud() {
        if (!API_URL.startsWith("http")) return;
        if (isSyncing) return;
        const currentSyncID = Date.now();
        lastFetchID = currentSyncID;
        const lastSave = parseInt(localStorage.getItem('lunch_last_save') || '0');
        if (Date.now() - lastSave < 5000) return;
        try {
            const res = await fetch(API_URL, { method: 'POST', body: JSON.stringify({ action: 'fetchData' }) });
            if (!res.ok) return;
            const text = await res.text();
            let data;
            try { data = JSON.parse(text); } catch (e) { return; }
            if (isSyncing || lastFetchID !== currentSyncID) return;
            if (data) {
                if (data.orders) {
                    memoryOrders = data.orders.map(o => {
                        if (!o.name && o.userName) o.name = o.userName;
                        o.date = normalizeDate(o.date);
                        o.price = Number(o.price) || 0;
                        o.paid = o.paid === true || o.paid === 'TRUE';
                        o.cutoffTime = normalizeTime(o.cutoffTime);
                        return o;
                    }).filter(o => o.date);
                    memoryUsers = (data.users || []).map(u => {
                        if (!u.name && u.userName) u.name = u.userName;
                        return u;
                    });
                    memoryRestaurants = data.restaurants || [];
                    memoryConfig = {};
                    (data.config || []).forEach(c => { memoryConfig[c.key] = c.value; });
                }
                updateLocalCache();
                updateDatalists();
                updateGrandTotal();
                if (!excelModal.classList.contains('hidden')) renderOrders();
                const sModal = document.getElementById('settings-modal');
                const isUserTyping = sModal && !sModal.classList.contains('hidden') && sModal.contains(document.activeElement) && ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName);
                if (sModal && !sModal.classList.contains('hidden') && !isUserTyping) renderSettingsTab();
            }
            handleFormState();
            toggleRoleUI();
        } catch (err) { console.error("雲端同步失敗", err); }
    }

    function getTodayString() {
        const today = new Date();
        return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    }

    function getOrders() { return memoryOrders; }

    function updateLocalCache() {
        try {
            localStorage.setItem(CLOUD_CACHE_KEY, JSON.stringify({
                orders: memoryOrders, users: memoryUsers, restaurants: memoryRestaurants, config: Object.entries(memoryConfig).map(([key, value]) => ({ key, value }))
            }));
        } catch (e) { }
    }

    async function saveCloudData(action, dataArray) {
        if (!API_URL.startsWith("http")) return;
        isSyncing = true;
        showSyncLoader();
        const payload = JSON.stringify({ action, data: dataArray });
        try {
            const response = await fetch(API_URL, { method: 'POST', body: payload });
            if (!response.ok) throw new Error(`HTTP Error! Status: ${response.status}`);
            const text = await response.text();
            if (text.trim() === "success") return true;
            return true;
        } catch (err) {
            console.error("雲端儲存失敗:", err);
            showToast(`雲端儲存失敗: ${err.message}`, 'error');
            return false;
        } finally {
            isSyncing = false;
            hideSyncLoader();
            lastSaveTimestamp = Date.now();
            localStorage.setItem('lunch_last_save', lastSaveTimestamp);
        }
    }

    function saveOrders(orders, specificAction = "saveOrders", specificData = null) {
        memoryOrders = orders;
        updateDatalists();
        updateLocalCache();
        saveCloudData(specificAction, specificData || orders);
    }

    function saveUsers(users) {
        memoryUsers = users;
        updateLocalCache();
        saveCloudData("saveUsers", users);
        updateDatalists();
    }

    async function saveRestaurants(rests) {
        memoryRestaurants = rests;
        updateLocalCache();
        const success = await saveCloudData("saveRestaurants", rests);
        if (success) updateDatalists();
    }

    function getSettings() {
        const defaultCutoffs = { '午餐': '11:00' };
        try {
            const s = JSON.parse(localStorage.getItem(SETTINGS_KEY));
            return { mealCutoffs: s?.mealCutoffs || defaultCutoffs, cutoffTime: s?.cutoffTime || '11:00' };
        } catch (e) { return { mealCutoffs: defaultCutoffs, cutoffTime: '11:00' }; }
    }

    function saveSettings(settings) { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); }

    const initialSettings = getSettings();
    if (initialSettings.cutoffTime) cutoffInputs.forEach(input => { if (input) input.value = initialSettings.cutoffTime; });
    dateInputs.forEach(input => { if (input) input.value = getTodayString(); });

    (function setDefaultMealType() {
        document.querySelectorAll('#meal-type, #meal-type-mob').forEach(sel => { if (sel) sel.value = '午餐'; });
    })();

    function updateDatalists() {
        const orders = getOrders();
        if (personNameInput) {
            const oldName = personNameInput.value;
            personNameInput.innerHTML = '<option value="" disabled selected>請選擇姓名</option>';
            const allNames = [...new Set([...memoryUsers.map(u => u.name), ...(currentUser ? [currentUser.name] : [])])].filter(Boolean);
            allNames.forEach(name => { personNameInput.innerHTML += `<option value="${name}">${name}</option>`; });
            const isAdmin = currentUser && currentUser.role === 'admin';
            if (currentUser && !isAdmin) {
                personNameInput.value = currentUser.name;
                personNameInput.disabled = true;
            } else {
                personNameInput.value = oldName || "";
                personNameInput.disabled = false;
            }
        }
        if (restaurantInputs && restaurantInputs.length > 0) {
            restaurantInputs.forEach(sel => {
                const oldVal = sel.value;
                sel.innerHTML = '<option value="">請選擇餐廳...</option>';
                memoryRestaurants.forEach(r => {
                    const opt = document.createElement('option');
                    opt.value = r.name; opt.textContent = r.name; sel.appendChild(opt);
                });
                sel.value = oldVal;
            });
        }
        if (itemHistoryDl) {
            const items = [...new Set(orders.map(o => o.item).filter(Boolean))];
            itemHistoryDl.innerHTML = '';
            items.forEach(i => { const opt = document.createElement('option'); opt.value = i; itemHistoryDl.appendChild(opt); });
        }
        renderQuickPrices(orders);
    }

    function renderQuickPrices(orders) {
        const quickContainer = document.getElementById('quick-prices-container');
        if (!quickContainer) return;
        const freq = {};
        orders.forEach(o => { freq[o.price] = (freq[o.price] || 0) + 1; });
        const topPrices = Object.keys(freq).sort((a, b) => freq[b] - freq[a]).slice(0, 4).map(Number);
        const displayPrices = topPrices.length >= 3 ? topPrices : [50, 60, 80, 100];
        quickContainer.innerHTML = '';
        displayPrices.forEach(p => {
            const btn = document.createElement('button');
            btn.type = 'button'; btn.className = 'quick-price-btn'; btn.textContent = `+$${p}`;
            btn.addEventListener('click', () => { itemPriceInput.value = p; itemPriceInput.focus(); });
            quickContainer.appendChild(btn);
        });
    }

    itemNameInput.addEventListener('change', () => {
        const typed = itemNameInput.value.trim();
        if (!typed) return;
        const match = getOrders().slice().reverse().find(o => o.item === typed);
        if (match && !itemPriceInput.value) {
            itemPriceInput.value = match.price;
            showToast(`已自動記憶價格：$${match.price}`, 'info');
        }
    });

    function isSessionLocked(dateStr, mealTypeStr) {
        const todayStr = getTodayString();
        if (dateStr < todayStr) return true;
        if (dateStr === todayStr) {
            const activeCutoff = getActiveCutoffTime();
            const now = new Date();
            const currentTimeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
            if (currentTimeStr >= normalizeTime(activeCutoff)) return true;
        }
        return false;
    }

    function getRecommendedRestaurant(date, mealType) {
        const sessionOrders = getOrders().filter(o => o.date === date && o.mealType === mealType);
        if (sessionOrders.length > 0) return { name: sessionOrders[0].restaurant, source: 'order' };
        const cloudRest = memoryConfig[`restaurant_${date}_${mealType}`];
        if (cloudRest) return { name: cloudRest, source: 'cloud' };
        const dayOfMonth = new Date(date + 'T12:00:00').getDate();
        const monthlyRest = memoryConfig[`monthly_${mealType}_${dayOfMonth}`] || '';
        if (monthlyRest) return { name: monthlyRest, source: 'monthly' };
        return { name: '', source: 'none' };
    }

    function getActiveCutoffTime() {
        const c1 = document.getElementById('cutoff-time');
        const c2 = document.getElementById('cutoff-time-mob');
        if (c1 && c1.offsetParent !== null) return c1.value;
        if (c2 && c2.offsetParent !== null) return c2.value;
        return (c1 ? c1.value : (c2 ? c2.value : '10:30')) || '10:30';
    }

    function handleFormState() {
        if (!orderDateInput || !mealTypeInput) return;
        const selectedDate = orderDateInput.value;
        const selectedMealType = mealTypeInput.value;
        const isSessionChanged = (selectedDate !== lastViewedDate || selectedMealType !== lastViewedMeal);
        const sessionOrders = getOrders().filter(o => o.date === selectedDate && o.mealType === selectedMealType);
        const anyOrder = sessionOrders.length > 0;
        const settings = getSettings();
        const sessionKey = `${selectedDate}_${selectedMealType}`;
        const cloudCutoff = memoryConfig[`cutoff_${sessionKey}`];
        const mealDefault = cloudCutoff || settings.mealCutoffs[selectedMealType] || settings.cutoffTime || '10:30';
        if (isSessionChanged && !anyOrder) cutoffInputs.forEach(input => { if (input) input.value = mealDefault; });
        const isTimeUp = isSessionLocked(selectedDate, selectedMealType);
        const currentOrderCutoff = getActiveCutoffTime();
        const recommendation = getRecommendedRestaurant(selectedDate, selectedMealType);
        const winner = recommendation.name;
        let displayWinner = '待定...';
        if (anyOrder || isTimeUp) displayWinner = winner || '待定...';
        restaurantInputs.forEach(input => {
            input.value = displayWinner; input.disabled = true;
            input.style.color = (displayWinner === '待定...') ? "var(--text-muted)" : "var(--text-main)";
        });
        const isAdmin = currentUser && currentUser.role === 'admin';
        const isTBD = (displayWinner === '待定...' && !isAdmin);
        if (orderFormContainer) orderFormContainer.classList.toggle('hidden', isTBD);
        const votePrompt = document.getElementById('vote-needed-msg');
        if (votePrompt) votePrompt.classList.toggle('hidden', !isTBD);
        if (isTimeUp) {
            if (lockedWarning) {
                lockedWarning.classList.remove('hidden');
                lockedWarning.innerHTML = `⚠️ 【${selectedMealType}】訂單已鎖定。`;
            }
            if (submitOrderBtn) { submitOrderBtn.disabled = true; submitOrderBtn.innerHTML = '🔒 已鎖定'; }
        } else {
            if (lockedWarning) lockedWarning.classList.add('hidden');
            if (submitOrderBtn) { submitOrderBtn.disabled = false; submitOrderBtn.innerHTML = '🚀 送出訂單'; }
        }
        lastViewedDate = selectedDate; lastViewedMeal = selectedMealType;
    }

    function getCommonInputs() {
        return {
            date: document.getElementById('order-date')?.value || document.getElementById('order-date-mob')?.value || getTodayString(),
            meal: document.getElementById('meal-type')?.value || document.getElementById('meal-type-mob')?.value || '午餐',
            rest: document.getElementById('restaurant-name')?.value || document.getElementById('restaurant-name-mob')?.value || '',
            cutoff: document.getElementById('cutoff-time')?.value || document.getElementById('cutoff-time-mob')?.value || '10:30'
        };
    }

    submitOrderBtn.addEventListener('click', () => {
        const inputs = getCommonInputs();
        const name = personNameInput.value.trim();
        const item = itemNameInput.value.trim();
        if (isSessionLocked(inputs.date, inputs.meal)) { showToast("此餐期已鎖定！", "error"); return; }
        let finalPrice = parseFloat(itemPriceInput.value) || 0;
        if (!name || !item || !inputs.rest || inputs.rest === '待定...') { showToast("請完整填寫資訊！", "error"); return; }
        const newOrder = { id: Date.now().toString(), date: inputs.date, mealType: inputs.meal, name: name, userName: name, item: item, price: finalPrice, restaurant: inputs.rest, cutoffTime: inputs.cutoff, paid: false };
        saveOrders([...getOrders(), newOrder], "addOrder", newOrder);
        personNameInput.value = (currentUser && currentUser.role === 'user') ? currentUser.name : '';
        itemNameInput.value = ''; itemPriceInput.value = '';
        showToast(`訂購成功：${item}`);
        updateGrandTotal();
    });

    function updateGrandTotal() {
        const wt = getWeekData(currentViewDate);
        const gTotal = wt.weekOrders.reduce((acc, cur) => acc + cur.price, 0);
        const elGrand = document.getElementById('dash-grand-total');
        if (elGrand) elGrand.textContent = `$${gTotal}`;
        const todayStr = getTodayString();
        const todayOrders = getOrders().filter(o => o.date === todayStr);
        const todayTotal = todayOrders.reduce((acc, cur) => acc + cur.price, 0);
        const elCount = document.getElementById('dash-today-count');
        const elTodayTotal = document.getElementById('dash-today-total');
        if (elCount) elCount.textContent = todayOrders.length;
        if (elTodayTotal) elTodayTotal.textContent = todayTotal;
    }

    function getWeekData(dateObj) {
        const allOrders = getOrders();
        const refDate = new Date(dateObj);
        const currentDay = refDate.getDay();
        const dist = currentDay === 0 ? 6 : currentDay - 1;
        const monday = new Date(refDate); monday.setDate(refDate.getDate() - dist);
        const weekDates = [];
        const days = ['(一)', '(二)', '(三)', '(四)', '(五)', '(六)', '(日)'];
        for (let i = 0; i < 7; i++) {
            const d = new Date(monday); d.setDate(monday.getDate() + i);
            weekDates.push({ dateString: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`, dayLabel: days[i] });
        }
        const weekOrders = allOrders.filter(o => o.date >= weekDates[0].dateString && o.date <= weekDates[6].dateString);
        return { weekDates, weekOrders, allOrders, labelText: `${weekDates[0].dateString} ~ ${weekDates[6].dateString}` };
    }

    function renderOrders() {
        const { weekDates, weekOrders, allOrders, labelText } = getWeekData(currentViewDate);
        if (currentWeekLabel) currentWeekLabel.innerText = labelText;
        let fWeekOrders = weekOrders; let fAllOrders = allOrders;
        if (currentUser && currentUser.role === 'user') {
            fWeekOrders = weekOrders.filter(o => o.name === currentUser.name);
            fAllOrders = allOrders.filter(o => o.name === currentUser.name);
        }
        const container = document.getElementById('dynamic-table-container');
        if (!container) return; container.innerHTML = '';
        if (currentActiveTab === 'tab-details') renderDetailsTable(weekDates, fAllOrders, container);
        else if (currentActiveTab === 'tab-caller') renderCallerTable(weekDates, fAllOrders, container);
        else if (currentActiveTab === 'tab-person') renderPersonTable(fWeekOrders, container);
    }

    function renderDetailsTable(weekDates, allOrders, container) {
        const table = document.createElement('table'); table.className = 'excel-table';
        table.innerHTML = `<thead><tr><th>日期 / 餐廳</th><th>姓名</th><th>餐點</th><th>金額</th><th>付清</th><th>操作</th></tr></thead>`;
        const tbody = document.createElement('tbody');
        weekDates.forEach(({ dateString, dayLabel }) => {
            const dayOrders = allOrders.filter(o => o.date === dateString);
            if (dayOrders.length === 0) {
                tbody.innerHTML += `<tr><td>${dateString} ${dayLabel}</td><td colspan="5" style="text-align:center;color:var(--text-muted);">無紀錄</td></tr>`;
            } else {
                dayOrders.forEach((order, idx) => {
                    const isAdmin = currentUser && currentUser.role === 'admin';
                    const isLocked = isSessionLocked(order.date, order.mealType);
                    const tr = document.createElement('tr');
                    if (order.paid) tr.classList.add('row-paid');
                    tr.innerHTML = `
                        ${idx === 0 ? `<td rowspan="${dayOrders.length}">${order.date}<br>🏠 ${order.restaurant}</td>` : ''}
                        <td>${order.name}</td><td>${order.item}</td><td>$${order.price}</td>
                        <td style="text-align:center;"><input type="checkbox" ${order.paid ? 'checked' : ''} ${isAdmin ? '' : 'disabled'} onchange="window.togglePaid('${order.id}', this.checked)"></td>
                        <td>
                            ${isAdmin || !isLocked ? `<button class="edit-record-btn" onclick="window.triggerEdit('${order.id}')">✏️</button><button class="delete-record-btn" onclick="window.deleteOrder('${order.id}')">🗑️</button>` : '🔒'}
                        </td>
                    `;
                    tbody.appendChild(tr);
                });
            }
        });
        table.appendChild(tbody); container.appendChild(table);
    }

    window.triggerEdit = function(id) {
        const order = getOrders().find(o => o.id === id);
        if (!order) return;
        const isAdmin = currentUser && currentUser.role === 'admin';
        if (isAdmin) { window.openEditOrderModal(id); }
        else {
            personNameInput.value = order.name; itemNameInput.value = order.item; itemPriceInput.value = order.price;
            document.getElementById('order-date').value = order.date;
            excelModal.classList.add('hidden'); window.scrollTo({ top: 0, behavior: 'smooth' });
            showToast("已填回表單，請修改後重新送出。");
            saveOrders(getOrders().filter(o => o.id !== id), "deleteOrder", { id: id });
        }
    };

    function renderCallerTable(weekDates, allOrders, container) {
        const table = document.createElement('table'); table.className = 'excel-table';
        table.innerHTML = `<thead><tr><th>日期 / 餐廳</th><th>明細匯總</th><th>小計</th></tr></thead>`;
        const tbody = document.createElement('tbody');
        weekDates.forEach(({ dateString }) => {
            const dayOrders = allOrders.filter(o => o.date === dateString);
            if (dayOrders.length === 0) return;
            const rest = dayOrders[0].restaurant;
            const items = {}; let total = 0;
            dayOrders.forEach(o => { items[o.item] = (items[o.item] || 0) + 1; total += o.price; });
            const itemStr = Object.entries(items).map(([k,v]) => `${k} x ${v}`).join('<br>');
            tbody.innerHTML += `<tr><td>${dateString}<br>🏠 ${rest}</td><td>${itemStr}</td><td>$${total}</td></tr>`;
        });
        table.appendChild(tbody); container.appendChild(table);
    }

    function renderPersonTable(weekOrders, container) {
        const table = document.createElement('table'); table.className = 'excel-table';
        table.innerHTML = `<thead><tr><th>姓名</th><th>次數</th><th>總額</th><th>狀態</th></tr></thead>`;
        const tbody = document.createElement('tbody');
        const map = {};
        weekOrders.forEach(o => {
            if (!map[o.name]) map[o.name] = { count: 0, total: 0, unpaid: 0 };
            map[o.name].count++; map[o.name].total += o.price; if (!o.paid) map[o.name].unpaid += o.price;
        });
        Object.entries(map).forEach(([name, d]) => {
            tbody.innerHTML += `<tr><td>${name}</td><td>${d.count}</td><td>$${d.total}</td><td>${d.unpaid === 0 ? '✅ 已清' : `❌ 欠$${d.unpaid}`}</td></tr>`;
        });
        table.appendChild(tbody); container.appendChild(table);
    }

    window.togglePaid = function(id, paid) {
        const orders = getOrders(); const idx = orders.findIndex(o => o.id === id);
        if (idx !== -1) { orders[idx].paid = paid; saveOrders(orders, "updateOrder", orders[idx]); updateGrandTotal(); renderOrders(); }
    };

    window.deleteOrder = function(id) { if (confirm('確定刪除？')) { saveOrders(getOrders().filter(o => o.id !== id), "deleteOrder", { id: id }); renderOrders(); updateGrandTotal(); } };

    const editOrderModal = document.getElementById('edit-order-modal');
    window.openEditOrderModal = function(id) {
        const order = getOrders().find(o => o.id === id); if (!order) return;
        document.getElementById('edit-order-id').value = order.id;
        document.getElementById('edit-order-user').value = order.name;
        document.getElementById('edit-order-item').value = order.item;
        document.getElementById('edit-order-price').value = order.price;
        document.getElementById('edit-order-note').value = order.note || '';
        document.getElementById('edit-order-paid').checked = !!order.paid;
        editOrderModal.classList.remove('hidden');
    };
    window.closeEditOrderModal = () => editOrderModal.classList.add('hidden');
    window.saveEditedOrder = () => {
        const id = document.getElementById('edit-order-id').value;
        const orders = getOrders(); const idx = orders.findIndex(o => o.id === id);
        if (idx !== -1) {
            orders[idx].item = document.getElementById('edit-order-item').value;
            orders[idx].price = parseFloat(document.getElementById('edit-order-price').value) || 0;
            orders[idx].paid = document.getElementById('edit-order-paid').checked;
            saveOrders(orders, "updateOrder", orders[idx]); closeEditOrderModal(); renderOrders(); updateGrandTotal();
        }
    };

    prevWeekBtn.onclick = () => { currentViewDate.setDate(currentViewDate.getDate() - 7); renderOrders(); };
    nextWeekBtn.onclick = () => { currentViewDate.setDate(currentViewDate.getDate() + 7); renderOrders(); };
    currentWeekBtn.onclick = () => { currentViewDate = new Date(); renderOrders(); };

    function renderSettingsTab() {
        const container = document.getElementById('settings-dynamic-content'); if (!container) return;
        if (activeSettingsTab === 'tab-users') {
            let h = `<input type="text" id="new-user-name" placeholder="姓名"><button onclick="window.addUser()">新增</button><table class="excel-table">`;
            memoryUsers.forEach(u => h += `<tr><td>${u.name}</td><td><button onclick="window.deleteUser('${u.id}')">刪</button></td></tr>`);
            container.innerHTML = h + `</table>`;
        } else if (activeSettingsTab === 'tab-restaurants') {
            let h = `<input type="text" id="new-rest-name" placeholder="店名"><button onclick="window.addRest()">新增</button><table class="excel-table">`;
            memoryRestaurants.forEach(r => h += `<tr><td>${r.name}</td><td><button onclick="window.deleteRest('${r.id}')">刪</button></td></tr>`);
            container.innerHTML = h + `</table>`;
        }
    }
    window.addUser = () => { const n = document.getElementById('new-user-name').value; if(n) saveUsers([...memoryUsers, {id:'U'+Date.now(), name:n}]); renderSettingsTab(); };
    window.deleteUser = (id) => { if(confirm('刪除？')) saveUsers(memoryUsers.filter(u=>u.id!==id)); renderSettingsTab(); };
    window.addRest = () => { const n = document.getElementById('new-rest-name').value; if(n) saveRestaurants([...memoryRestaurants, {id:'R'+Date.now(), name:n}]); renderSettingsTab(); };
    window.deleteRest = (id) => { if(confirm('刪除？')) saveRestaurants(memoryRestaurants.filter(r=>r.id!==id)); renderSettingsTab(); };

    document.addEventListener('click', (e) => {
        const tab = e.target.closest('.tab-btn, .settings-tab-btn'); if (!tab) return;
        const name = tab.dataset.tab;
        if (tab.classList.contains('settings-tab-btn')) { activeSettingsTab = name; renderSettingsTab(); }
        else { highlightTab(name); renderOrders(); }
    });

    function toggleRoleUI() {
        if (!currentUser) return; const isAdmin = currentUser.role === 'admin';
        document.body.classList.toggle('admin-mode', isAdmin);
        document.querySelectorAll('.admin-only').forEach(el => el.style.display = isAdmin ? '' : 'none');
        document.getElementById('admin-dashboard').style.display = isAdmin ? '' : 'none';
        document.getElementById('order-form-container').style.display = isAdmin ? 'none' : '';
        if (isAdmin) { renderAdminSchedule(); syncAdminDash(); }
        else { if(personNameInput) { personNameInput.value = currentUser.name; personNameInput.disabled = true; } }
        renderOrders();
    }

    function syncAdminDash() {
        document.getElementById('admin-order-date').value = document.getElementById('order-date').value;
        const sel = document.getElementById('admin-restaurant-name');
        sel.innerHTML = '<option value="">請選擇...</option>' + memoryRestaurants.map(r => `<option value="${r.name}">${r.name}</option>`).join('');
    }

    function renderAdminSchedule() {
        const container = document.getElementById('admin-weekly-schedule'); if (!container) return;
        let h = '<div style="display:grid;grid-template-columns:repeat(7,1fr);gap:4px;">';
        for(let i=1;i<=31;i++) h += `<div style="border:1px solid #ccc;padding:2px;">${i}<select data-day="${i}" class="mon-sel"><option value="">-</option>${memoryRestaurants.map(r=>`<option value="${r.name}">${r.name}</option>`).join('')}</select></div>`;
        container.innerHTML = h + '</div><button onclick="window.saveMon()">儲存排餐</button>';
    }
    window.saveMon = () => {
        document.querySelectorAll('.mon-sel').forEach(s => memoryConfig[`monthly_午餐_${s.dataset.day}`] = s.value);
        saveCloudData("saveConfig", Object.entries(memoryConfig).map(([k,v])=>({key:k, value:"'"+v})));
        showToast("已儲存！");
    };

    function checkAuth() {
        const u = localStorage.getItem('lunch_user');
        if (u) { currentUser = JSON.parse(u); loginOverlay.style.display = 'none'; toggleRoleUI(); }
        else loginOverlay.style.display = 'flex';
    }

    authSubmitBtn.onclick = () => {
        const n = authNameInput.value.trim(); const p = authPassInput.value.trim();
        if (n==='admin' && p==='1234') { loginSuccess(n, 'admin'); }
        else { const u = memoryUsers.find(u=>u.name===n && u.password===p); if(u) loginSuccess(n, 'user'); else showToast("錯誤","error"); }
    };
    function loginSuccess(n, r) { currentUser = {name:n, role:r}; localStorage.setItem('lunch_user', JSON.stringify(currentUser)); location.reload(); }
    safeListen(document.getElementById('logout-btn'), 'click', () => { localStorage.removeItem('lunch_user'); location.reload(); });

    try { checkAuth(); } catch(e){}
    const cached = localStorage.getItem(CLOUD_CACHE_KEY);
    if (cached) {
        const c = JSON.parse(cached); memoryOrders = c.orders || []; memoryUsers = c.users || []; memoryRestaurants = c.restaurants || [];
        if (c.config) c.config.forEach(i => memoryConfig[i.key] = i.value);
        updateDatalists(); handleFormState(); updateGrandTotal();
    }
    fetchFromCloud(); setInterval(fetchFromCloud, 15000);
});
