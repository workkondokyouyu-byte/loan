'use strict';

const MAX_BONUS_MONTHS = 4;
const MAX_TOTAL_MONTHS = 600;

const form = document.getElementById('loan-form');
const tabs = [...document.querySelectorAll('.tab')];
const errorEl = document.getElementById('error');
const bonusDetail = document.getElementById('bonus-detail');
const bonusMonthsEl = document.getElementById('bonus-months');
const startYearEl = document.getElementById('start-year');
const startMonthEl = document.getElementById('start-month');
const resultEl = document.getElementById('result');
const summaryEl = document.getElementById('summary');
const scheduleBody = document.getElementById('schedule-body');
const resultNoteEl = document.getElementById('result-note');

// 'forward'：返済期間から返済額を計算 ／ 'reverse'：返済額から返済期間を計算
let mode = 'forward';

const yen = (value) => `${Math.round(value).toLocaleString('ja-JP')}円`;

// ---------- 画面の初期化 ----------

function initForm() {
  // 返済開始年月の初期値は翌月
  const now = new Date();
  const next = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  startYearEl.value = next.getFullYear();

  for (let m = 1; m <= 12; m++) {
    const label = document.createElement('label');
    label.innerHTML = `<input type="checkbox" value="${m}"> ${m}月`;
    bonusMonthsEl.appendChild(label);
  }
  startMonthEl.value = next.getMonth() + 1;

  // 一般的なボーナス月（6月・12月）を初期選択
  bonusMonthsEl.querySelectorAll('input').forEach((cb) => {
    cb.checked = cb.value === '6' || cb.value === '12';
  });
}

function switchMode(nextMode) {
  mode = nextMode;
  tabs.forEach((tab) => {
    tab.setAttribute('aria-selected', String(tab.dataset.tab === mode));
  });
  form.querySelectorAll('[data-mode]').forEach((el) => {
    el.hidden = el.dataset.mode !== mode;
  });
  errorEl.textContent = '';
  resultEl.hidden = true;
}

function updateBonusVisibility() {
  const hasBonus = form.elements.bonus.value === 'yes';
  bonusDetail.hidden = !hasBonus;
}

// 年4回を超えて選択できないよう、上限に達したら残りを無効化する
function updateBonusMonthLimit() {
  const boxes = [...bonusMonthsEl.querySelectorAll('input')];
  const checkedCount = boxes.filter((cb) => cb.checked).length;
  boxes.forEach((cb) => {
    cb.disabled = !cb.checked && checkedCount >= MAX_BONUS_MONTHS;
  });
}

// ---------- 入力値の取得と検証 ----------

// 「5,000,000」「5000000円」などの入力を円単位の数値に変換する（不正な値は NaN）
function parseYen(text) {
  const normalized = text
    .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/[,，、\s円]/g, '');
  return /^\d+$/.test(normalized) ? Number(normalized) : NaN;
}

// 両方のタブで共通の入力項目
function readCommonInputs() {
  const amount = Number(document.getElementById('amount').value);
  const rate = Number(document.getElementById('rate').value);
  const startYear = Number(startYearEl.value);
  const startMonth = Number(startMonthEl.value);
  const method = form.elements.method.value;
  const hasBonus = form.elements.bonus.value === 'yes';
  const bonusMonths = hasBonus
    ? [...bonusMonthsEl.querySelectorAll('input:checked')].map((cb) => Number(cb.value))
    : [];

  if (!(amount > 0)) throw new Error('借入金額を正しく入力してください。');
  if (!(rate >= 0 && rate <= 20)) throw new Error('年利は0〜20%の範囲で入力してください。');
  if (!Number.isInteger(startYear) || startYear < 1900 || startYear > 2200) {
    throw new Error('返済開始年を正しく入力してください。');
  }
  if (!Number.isInteger(startMonth) || startMonth < 1 || startMonth > 12) {
    throw new Error('返済開始月は1〜12の整数で入力してください。');
  }
  if (hasBonus && bonusMonths.length === 0) throw new Error('ボーナス返済月を1つ以上選択してください。');

  return {
    principal: Math.round(amount * 10000),
    annualRate: rate,
    method,
    startYear,
    startMonth,
    hasBonus,
    bonusMonths,
  };
}

// 「返済額を計算」タブの入力項目
function readForwardInputs() {
  const common = readCommonInputs();
  const years = Number(document.getElementById('years').value || 0);
  const months = Number(document.getElementById('months').value || 0);
  const bonusAmount = common.hasBonus ? parseYen(document.getElementById('bonus-amount').value) : 0;

  if (!Number.isInteger(years) || !Number.isInteger(months) || years < 0 || months < 0 || months > 11) {
    throw new Error('返済期間は「年」は0以上、「ヶ月」は0〜11の整数で入力してください。');
  }
  const totalMonths = years * 12 + months;
  if (totalMonths < 1 || totalMonths > MAX_TOTAL_MONTHS) {
    throw new Error('返済期間は1ヶ月〜50年の範囲で入力してください。');
  }
  if (common.hasBonus) {
    if (!(bonusAmount > 0)) throw new Error('ボーナス返済分の金額を円単位の整数で入力してください。');
    if (bonusAmount >= common.principal) throw new Error('ボーナス返済分は借入金額より小さくしてください。');
  }

  return { ...common, totalMonths, bonusPrincipal: bonusAmount };
}

// 「返済期間を計算」タブの入力項目
function readReverseInputs() {
  const common = readCommonInputs();
  const monthlyPayment = parseYen(document.getElementById('monthly-payment').value);
  const bonusPayment = common.hasBonus ? parseYen(document.getElementById('bonus-payment').value) : 0;

  if (!(monthlyPayment > 0)) throw new Error('月々の返済額を円単位の整数で入力してください。');
  if (common.hasBonus && !(bonusPayment > 0)) {
    throw new Error('ボーナス1回あたりの返済額を円単位の整数で入力してください。');
  }

  return { ...common, monthlyPayment, bonusPayment };
}

// ---------- 返済スケジュールの計算 ----------

// 返済開始年月から数えて i 回目（0始まり）の返済年月
function paymentDate(startYear, startMonth, i) {
  const index = startMonth - 1 + i;
  return { year: startYear + Math.floor(index / 12), month: (index % 12) + 1 };
}

// 元利均等の毎回返済額（discountFactors は各返済時点の割引係数）
function levelPayment(principal, discountFactors) {
  const sum = discountFactors.reduce((a, b) => a + b, 0);
  return Math.round(principal / sum);
}

// 返済期間から返済額を計算する（月々返済分とボーナス返済分を別々に管理）
function simulate(input) {
  const { principal, bonusPrincipal, annualRate, method, totalMonths, startYear, startMonth, bonusMonths } = input;
  const r = annualRate / 100 / 12;
  const isEqualPayment = method === 'equal-payment';

  const dates = [];
  for (let i = 0; i < totalMonths; i++) {
    dates.push(paymentDate(startYear, startMonth, i));
  }
  const isBonusMonth = dates.map((d) => bonusPrincipal > 0 && bonusMonths.includes(d.month));
  const bonusCount = isBonusMonth.filter(Boolean).length;
  if (bonusPrincipal > 0 && bonusCount === 0) {
    throw new Error('返済期間内に選択したボーナス月がありません。返済期間や開始年月を見直してください。');
  }

  // 通常返済分（毎月）
  let regularBalance = principal - bonusPrincipal;
  const monthlyFactors = dates.map((_, i) => Math.pow(1 + r, -(i + 1)));
  const regularPayment = isEqualPayment ? levelPayment(regularBalance, monthlyFactors) : 0;
  const regularPrincipalEach = Math.floor(regularBalance / totalMonths);

  // ボーナス返済分
  let bonusBalance = bonusPrincipal;
  let bonusAccrued = 0; // 前回ボーナス返済以降に発生した未払利息
  let bonusPaidCount = 0;
  const bonusFactors = monthlyFactors.filter((_, i) => isBonusMonth[i]);
  const bonusPayment = isEqualPayment && bonusCount > 0 ? levelPayment(bonusPrincipal, bonusFactors) : 0;
  const bonusPrincipalEach = bonusCount > 0 ? Math.floor(bonusPrincipal / bonusCount) : 0;

  const rows = [];
  for (let i = 0; i < totalMonths; i++) {
    const isLast = i === totalMonths - 1;

    const regularInterest = Math.round(regularBalance * r);
    let regularPrincipal;
    if (isLast) {
      regularPrincipal = regularBalance;
    } else if (isEqualPayment) {
      regularPrincipal = Math.min(regularPayment - regularInterest, regularBalance);
    } else {
      regularPrincipal = Math.min(regularPrincipalEach, regularBalance);
    }
    regularBalance -= regularPrincipal;

    let bonusPrincipalPaid = 0;
    let bonusInterestPaid = 0;
    if (bonusBalance > 0) {
      // 元利均等は未払利息にも利息が付く（月複利）、元金均等は元金にのみ利息が付く
      const interestBase = isEqualPayment ? bonusBalance + bonusAccrued : bonusBalance;
      bonusAccrued += Math.round(interestBase * r);

      if (isBonusMonth[i]) {
        bonusPaidCount++;
        const isLastBonus = bonusPaidCount === bonusCount;
        if (isEqualPayment) {
          const total = isLastBonus ? bonusBalance + bonusAccrued : bonusPayment;
          bonusInterestPaid = Math.min(bonusAccrued, total);
          bonusPrincipalPaid = total - bonusInterestPaid;
        } else {
          bonusInterestPaid = bonusAccrued;
          bonusPrincipalPaid = isLastBonus ? bonusBalance : bonusPrincipalEach;
        }
        bonusAccrued -= bonusInterestPaid;
        bonusBalance -= bonusPrincipalPaid;
      }
    }

    rows.push(makeRow(i, dates[i], {
      regularPrincipal,
      regularInterest,
      bonusPrincipal: bonusPrincipalPaid,
      bonusInterest: bonusInterestPaid,
      balanceAfterRegular: regularBalance + bonusBalance + bonusPrincipalPaid,
      balance: regularBalance + bonusBalance,
    }));
  }
  return rows;
}

// 返済額から返済期間を計算する（残高を1本で管理し、完済するまで返済を続ける）
// 利息は毎月の返済で支払い、ボーナス返済は全額を元金に充てる
function simulateReverse(input) {
  const { principal, annualRate, method, monthlyPayment, bonusPayment, startYear, startMonth, bonusMonths } = input;
  const r = annualRate / 100 / 12;
  const isEqualPayment = method === 'equal-payment';

  const firstInterest = Math.round(principal * r);
  if (monthlyPayment <= firstInterest) {
    throw new Error(`月々の返済額が初回の利息（${yen(firstInterest)}）以下のため、返済が終わりません。月々の返済額を増やしてください。`);
  }
  // 元金均等では、初回の返済額から求めた元金返済額を毎月一定にする
  const principalEach = monthlyPayment - firstInterest;

  let balance = principal;
  const rows = [];
  for (let i = 0; balance > 0; i++) {
    if (i >= MAX_TOTAL_MONTHS) {
      throw new Error('返済期間が50年を超えます。月々の返済額やボーナス返済額を増やしてください。');
    }
    const date = paymentDate(startYear, startMonth, i);

    const regularInterest = Math.round(balance * r);
    const plannedPrincipal = isEqualPayment ? monthlyPayment - regularInterest : principalEach;
    const regularPrincipal = Math.min(plannedPrincipal, balance);
    balance -= regularPrincipal;
    const balanceAfterRegular = balance;

    const isBonusMonth = bonusPayment > 0 && bonusMonths.includes(date.month);
    const bonusPrincipal = isBonusMonth ? Math.min(bonusPayment, balance) : 0;
    balance -= bonusPrincipal;

    rows.push(makeRow(i, date, {
      regularPrincipal,
      regularInterest,
      bonusPrincipal,
      bonusInterest: 0,
      balanceAfterRegular,
      balance,
    }));
  }
  return rows;
}

function makeRow(i, date, parts) {
  const regular = parts.regularPrincipal + parts.regularInterest;
  const bonus = parts.bonusPrincipal + parts.bonusInterest;
  return {
    no: i + 1,
    ...date,
    ...parts,
    isBonus: bonus > 0,
    regular,
    bonus,
    total: regular + bonus,
    principal: parts.regularPrincipal + parts.bonusPrincipal,
    interest: parts.regularInterest + parts.bonusInterest,
  };
}

// ---------- 結果の表示 ----------

function formatTerm(totalMonths) {
  const years = Math.floor(totalMonths / 12);
  const months = totalMonths % 12;
  if (years === 0) return `${months}ヶ月`;
  return months === 0 ? `${years}年` : `${years}年${months}ヶ月`;
}

function renderSummary(rows, input) {
  const totalPayment = rows.reduce((sum, row) => sum + row.total, 0);
  const totalInterest = rows.reduce((sum, row) => sum + row.interest, 0);
  const first = rows[0];
  const last = rows[rows.length - 1];
  const firstBonus = rows.find((row) => row.isBonus);

  const items = [];
  if (mode === 'reverse') {
    items.push(['返済期間', `${formatTerm(rows.length)}（${rows.length}回）`]);
    items.push(['完済年月', `${last.year}年${last.month}月`]);
  }
  if (input.method === 'equal-payment') {
    items.push(['毎月の返済額', yen(first.regular)]);
    if (mode === 'reverse') items.push(['最終回の返済額', yen(last.total)]);
  } else {
    items.push(['毎月の返済額（初回）', yen(first.regular)]);
    items.push(['毎月の返済額（最終回）', yen(last.regular)]);
  }
  if (firstBonus) {
    items.push(['ボーナス月の加算額（初回）', yen(firstBonus.bonus)]);
  }
  if (mode === 'forward') items.push(['返済回数', `${rows.length}回`]);
  items.push(['総返済額', yen(totalPayment)]);
  items.push(['うち利息総額', yen(totalInterest)]);

  summaryEl.innerHTML = items
    .map(([term, value]) => `<div><dt>${term}</dt><dd>${value}</dd></div>`)
    .join('');

  const notes = ['※ 金額は1円未満を四捨五入しており、最終回で端数を調整しています。実際の返済額は金融機関の計算方法により異なります。'];
  if (mode === 'reverse' && firstBonus) {
    notes.push('※ 返済期間の計算では、利息は毎月の返済で支払い、ボーナス返済は全額を元金の返済に充てています。');
  }
  resultNoteEl.innerHTML = notes.join('<br>');
}

// ボーナス返済のある月は「月々」「ボーナス」の2行に分けて表示する
function renderSchedule(rows) {
  scheduleBody.innerHTML = rows
    .map((row) => {
      const hasBonus = row.bonus > 0;
      const span = hasBonus ? ' rowspan="2"' : '';
      const regularRow = `
      <tr class="${hasBonus ? 'has-bonus' : ''}">
        <td class="month-cell"${span}>${row.no}</td>
        <td class="month-cell center"${span}>${row.year}年${row.month}月</td>
        <td class="center">月々</td>
        <td>${yen(row.regular)}</td>
        <td>${yen(row.regularPrincipal)}</td>
        <td>${yen(row.regularInterest)}</td>
        <td>${yen(hasBonus ? row.balanceAfterRegular : row.balance)}</td>
      </tr>`;
      if (!hasBonus) return regularRow;
      return `${regularRow}
      <tr class="bonus">
        <td class="center">ボーナス</td>
        <td>${yen(row.bonus)}</td>
        <td>${yen(row.bonusPrincipal)}</td>
        <td>${yen(row.bonusInterest)}</td>
        <td>${yen(row.balance)}</td>
      </tr>`;
    })
    .join('');
}

// 円単位の入力欄は、入力後に3桁区切りで表示し直す
document.querySelectorAll('input.yen').forEach((input) => {
  input.addEventListener('blur', () => {
    const value = parseYen(input.value);
    if (!Number.isNaN(value)) input.value = value.toLocaleString('ja-JP');
  });
});

// ---------- イベント ----------

tabs.forEach((tab) => {
  tab.addEventListener('click', () => switchMode(tab.dataset.tab));
});

form.addEventListener('change', (event) => {
  if (event.target.name === 'bonus') updateBonusVisibility();
  if (bonusMonthsEl.contains(event.target)) updateBonusMonthLimit();
});

form.addEventListener('submit', (event) => {
  event.preventDefault();
  errorEl.textContent = '';
  try {
    const input = mode === 'forward' ? readForwardInputs() : readReverseInputs();
    const rows = mode === 'forward' ? simulate(input) : simulateReverse(input);
    renderSummary(rows, input);
    renderSchedule(rows);
    resultEl.hidden = false;
    resultEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (error) {
    resultEl.hidden = true;
    errorEl.textContent = error.message;
  }
});

initForm();
switchMode('forward');
updateBonusVisibility();
updateBonusMonthLimit();
