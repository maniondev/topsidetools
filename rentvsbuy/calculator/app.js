// Rent vs Buy web calculator.
//
// All arithmetic comes from calc.js, which is compiled straight out of the iOS
// app by ../sync-math.sh. Nothing in this file may compute a financial figure:
// if a number is missing, add it to the app's utils/ and regenerate, so the two
// products can never disagree. This file is presentation only.

import {
  calculate, DEFAULT_INPUTS, HORIZONS, SENS_OFFSETS,
  breakEvenYear, sensitivityGrid, monthlyCostSeries,
  formatCurrency, formatPercent,
} from './calc.js';

const STORE_KEY = 'rvb_inputs_v1';

// ── Field spec ──────────────────────────────────────────────────────────────
// Labels, units and parsing live here once. `pct` fields are held as 0 to 1 in
// the model and shown as whole percents, which is the only conversion in the
// page and the easiest thing to get wrong twice.

const GROUPS = [
  { name: 'The basics', open: true, fields: [
    ['monthlyRent',            'Monthly rent',            'money'],
    ['homePrice',              'Home price',              'money'],
    ['downPaymentPct',         'Down payment',            'pct', 'Under 20% adds PMI'],
  ]},
  { name: 'If you rent', open: false, fields: [
    ['rentAppreciation',       'Yearly rent increase',    'pct'],
    ['equityReturn',           'Expected stock return',   'pct', 'What the down payment earns instead'],
    ['rentersInsuranceAnnual', "Renter's insurance",      'money', 'Per year'],
    ['renterUtilities',        'Utilities',               'money', 'Per month'],
  ]},
  { name: 'If you buy', open: false, fields: [
    ['mortgageRate',           'Mortgage rate',           'pct'],
    ['mortgageTerm',           'Mortgage term',           'years'],
    ['closingCostsPct',        'Closing costs',           'pct', 'Share of home price'],
    ['appreciation',           'Home appreciation',       'pct', 'Per year'],
    ['propertyTaxRate',        'Property tax',            'pct', 'Per year, of value'],
    ['homeInsurancePct',       'Home insurance',          'pct', 'Per year, of value'],
    ['maintenancePct',         'Maintenance',             'pct', 'Per year, of value'],
    ['pmiRate',                'PMI rate',                'pct', 'Per year, of loan'],
    ['hoa',                    'HOA',                     'money', 'Per month'],
    ['buyerUtilities',         'Utilities',               'money', 'Per month'],
  ]},
  { name: 'Tax', open: false, fields: [
    ['standardDeduction',      'Standard deduction',      'money'],
    ['taxRate',                'Marginal tax rate',       'pct', 'Federal plus state'],
  ]},
];

// ── State ───────────────────────────────────────────────────────────────────

let inputs = loadInputs();
let horizon = 10;
let sensHorizon = 10;

function loadInputs() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return { ...DEFAULT_INPUTS };
    const saved = JSON.parse(raw);
    // Merge over the defaults rather than trusting the stored object: a key
    // added to the app later would otherwise arrive undefined and turn every
    // downstream figure into NaN.
    const merged = { ...DEFAULT_INPUTS };
    for (const k of Object.keys(DEFAULT_INPUTS)) {
      if (typeof saved[k] === 'number' && isFinite(saved[k])) merged[k] = saved[k];
    }
    return merged;
  } catch {
    return { ...DEFAULT_INPUTS };
  }
}

function saveInputs() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(inputs)); } catch {}
}

// ── Helpers ─────────────────────────────────────────────────────────────────

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const money = (v) => formatCurrency(v);
const compact = (v) => formatCurrency(v, true);
const yr = (n) => `${n} ${n === 1 ? 'year' : 'years'}`;

/** Percent held as 0 to 1, shown as a whole number with no trailing zeros. */
const pctIn = (v) => String(Number((v * 100).toFixed(4)));

function section(title, sub, body, open = false) {
  return `<details class="sec"${open ? ' open' : ''}>
    <summary><span class="sec-title">${esc(title)}${sub ? `<span class="sec-sub">${esc(sub)}</span>` : ''}</span></summary>
    <div class="sec-body">${body}</div>
  </details>`;
}

const table = (head, rows, cls = '') =>
  `<div class="scroller"><table class="${cls}"><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table></div>`;

const kv = (k, v, cls = '') => `<div class="kv"><span class="k">${esc(k)}</span><span class="v ${cls}">${v}</span></div>`;

// ── Inputs ──────────────────────────────────────────────────────────────────

function renderInputs() {
  const form = document.getElementById('inputs');
  form.querySelectorAll('.group').forEach((n) => n.remove());

  for (const g of GROUPS) {
    const fields = g.fields.map(([key, label, kind, hint]) => {
      const isPct = kind === 'pct';
      const val = isPct ? pctIn(inputs[key]) : String(inputs[key]);
      const wrapCls = isPct || kind === 'years' ? 'suffix' : 'prefix';
      const affix = isPct ? '%' : kind === 'years' ? 'yr' : '$';
      const step = isPct ? '0.05' : kind === 'years' ? '1' : '100';
      return `<div class="field">
        <label for="f-${key}">${esc(label)}${hint ? `<span class="hint">${esc(hint)}</span>` : ''}</label>
        <span class="inputwrap ${wrapCls}">
          <input id="f-${key}" name="${key}" data-kind="${kind}" type="number" step="${step}"
                 inputmode="decimal" value="${val}">
          <span class="affix">${affix}</span>
        </span>
      </div>`;
    }).join('');

    form.insertAdjacentHTML('beforeend',
      `<details class="group"${g.open ? ' open' : ''}>
        <summary>${esc(g.name)}</summary>
        <div class="group-body">${fields}</div>
      </details>`);
  }
}

// ── Results ─────────────────────────────────────────────────────────────────

function render() {
  const r = calculate(inputs);
  const p = r.periods.find((x) => x.years === horizon) || r.periods[0];
  const rentWins = p.difference > 0;
  const be = breakEvenYear(r);

  document.getElementById('results').innerHTML = [
    verdict(p, rentWins),
    horizonPicker(),
    nwCards(p, rentWins),
    secNetWorthOverTime(r),
    secNetWorthComparison(r),
    secBreakEven(be, r),
    secCashFlow(r),
    secUpfront(r),
    secMonthlyCostOverTime(r),
    secSensitivity(),
    secBreakEvenAppreciation(r),
    secBreakEvenReturn(r),
    secBuyerBreakdown(r),
    secRenterBreakdown(r),
    secTaxBreakdown(r),
    `<p class="disclaimer">Estimates only, based entirely on the assumptions above. Selling costs are not deducted from the buyer's net worth, so buying is shown at its most favourable. Not financial advice.</p>`,
  ].join('');
}

function verdict(p, rentWins) {
  const cls = rentWins ? 'rent' : 'buy';
  const who = rentWins ? 'Renting comes out ahead' : 'Buying comes out ahead';
  return `<div class="verdict ${cls}">
    <div class="eyebrow">After ${yr(horizon)}</div>
    <h2>${who}</h2>
    <p>by ${money(Math.abs(p.difference))} of net worth</p>
  </div>`;
}

function horizonPicker() {
  return `<div class="horizons" role="group" aria-label="Time horizon">${
    HORIZONS.map((y) => `<button type="button" data-horizon="${y}" aria-pressed="${y === horizon}">${y === 1 ? '1 year' : `${y} years`}</button>`).join('')
  }</div>`;
}

function nwCards(p, rentWins) {
  const card = (cls, who, val, win) => `<div class="nw-card ${cls}${win ? ' win' : ''}">
    ${win ? '<span class="badge">AHEAD</span>' : ''}
    <div class="who">${who}</div>
    <div class="amt">${compact(val)}</div>
  </div>`;
  return `<div class="nw-row">
    ${card('rent', 'Renting', p.renterNetWorth, rentWins)}
    ${card('buy', 'Buying', p.buyerNetWorth, !rentWins)}
  </div>`;
}

// 1 ─ Net worth over time
function secNetWorthOverTime(r) {
  const max = Math.max(...r.periods.flatMap((p) => [p.renterNetWorth, p.buyerNetWorth]), 1);
  const W = 640, H = 220, pad = 26, gw = (W - pad) / r.periods.length;
  const bars = r.periods.map((p, i) => {
    const x = pad + i * gw, bw = (gw - 18) / 2;
    const hr = Math.max(1, (p.renterNetWorth / max) * (H - 46));
    const hb = Math.max(1, (p.buyerNetWorth / max) * (H - 46));
    return `<rect x="${x}" y="${H - 26 - hr}" width="${bw}" height="${hr}" rx="3" fill="var(--teal)"/>
      <rect x="${x + bw + 5}" y="${H - 26 - hb}" width="${bw}" height="${hb}" rx="3" fill="var(--orange)"/>
      <text x="${x + bw + 2.5}" y="${H - 9}" text-anchor="middle" font-size="11" fill="var(--muted)">${p.years}y</text>`;
  }).join('');
  return section('Net worth over time', 'Both paths, side by side, at every horizon',
    `<div class="scroller"><svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Net worth of renting versus buying at 1, 5, 10, 20 and 30 years">
      <line x1="${pad}" y1="${H - 26}" x2="${W}" y2="${H - 26}" stroke="var(--line)"/>
      ${bars}
    </svg></div>
    <div class="legend"><span><i style="background:var(--teal)"></i>Renting</span><span><i style="background:var(--orange)"></i>Buying</span></div>`,
    true);
}

// 2 ─ Net worth comparison
function secNetWorthComparison(r) {
  const rows = r.periods.map((p) => `<tr${p.years === horizon ? ' class="is-current"' : ''}>
    <td>${yr(p.years)}</td>
    <td class="rent">${money(p.renterNetWorth)}</td>
    <td class="buy">${money(p.buyerNetWorth)}</td>
    <td class="${p.difference > 0 ? 'rent' : 'buy'}"><strong>${p.difference > 0 ? 'Renting' : 'Buying'}</strong> by ${compact(Math.abs(p.difference))}</td>
  </tr>`).join('');
  return section('Net worth comparison', 'What each path is worth at the end',
    table('<th>Horizon</th><th class="rent">Renting</th><th class="buy">Buying</th><th>Winner</th>', rows));
}

// 3 ─ Break-even year
function secBreakEven(be, r) {
  const alwaysRent = r.periods.every((p) => p.difference > 0);
  let body;
  if (be) {
    const cls = be.buyingTakesOver ? 'buy' : 'rent';
    body = `<div class="callout ${cls}">
        <div class="big">${be.year.toFixed(1)} years</div>
        <div class="note" style="margin-top:4px">${be.buyingTakesOver
          ? 'Renting is ahead before this point. Buying is ahead after it.'
          : 'Buying is ahead before this point. Renting is ahead after it.'}</div>
      </div>
      <p class="note">Interpolated between the two horizons either side of the crossing, so treat it as approximate. Staying put for less than this makes the other option the better financial choice.</p>`;
  } else {
    const cls = alwaysRent ? 'rent' : 'buy';
    body = `<div class="callout ${cls}">
        <div class="big">No crossover</div>
        <div class="note" style="margin-top:4px">${alwaysRent ? 'Renting' : 'Buying'} wins at every horizon from 1 to 30 years, on these assumptions.</div>
      </div>
      <p class="note">A result with no crossover usually means one assumption is doing a lot of work. The sensitivity grid below is the fastest way to find out which.</p>`;
  }
  return section('Break-even year', 'When the winner changes', body);
}

// 4 ─ Monthly cash flow
function secCashFlow(r) {
  const rentSide = [
    ['Rent', inputs.monthlyRent],
    ["Renter's insurance", inputs.rentersInsuranceAnnual / 12],
    ['Utilities', inputs.renterUtilities],
  ];
  const buySide = [
    ['Mortgage', r.monthlyMortgage],
    ['Property tax', r.monthlyPropertyTax],
    ['Home insurance', r.monthlyHomeInsurance],
    ['Maintenance', r.monthlyMaintenance],
    ['HOA', inputs.hoa],
    ['PMI', r.monthlyPMI],
    ['Utilities', inputs.buyerUtilities],
  ].filter(([, v]) => v > 0);

  const col = (title, cls, rows, total) => `<div>
    <h3 style="font-size:13px;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);margin-bottom:6px">${title}</h3>
    ${rows.map(([k, v]) => kv(k, money(v))).join('')}
    ${kv('Total each month', `<span class="${cls}">${money(total)}</span>`)}
  </div>`;

  const diff = r.monthlyRenterSavings;
  return section('Monthly cash flow detail', 'What leaves your account each month, today',
    `<div class="grid2">
      ${col('Renting', 'rent', rentSide, r.monthlyRenterCost)}
      ${col('Buying', 'buy', buySide, r.totalMonthlyOwnerCost)}
    </div>
    <p class="note">${diff > 0
      ? `Owning costs ${money(diff)} more per month right now. That difference is what the renter invests, and it is the single biggest reason renting can win.`
      : `Renting costs ${money(Math.abs(diff))} more per month right now, so the owner is the one investing the difference.`}
      ${r.monthlyPMI > 0 ? ` PMI ends around month ${Math.round(r.pmiEndMonth)}, once the loan falls to 80% of the purchase price.` : ''}</p>`);
}

// 5 ─ Upfront costs
function secUpfront(r) {
  return section('Upfront costs to buy', 'What you need on day one',
    kv('Down payment', money(r.downPayment)) +
    kv('Closing costs', money(r.closingCosts)) +
    `<div class="kv total" style="border-top:1.5px solid var(--line);margin-top:2px"><span class="k"><strong>Total cash needed</strong></span><span class="v buy">${money(r.initialInvestment)}</span></div>` +
    `<p class="note">This is also the amount the renter invests on day one, which is what makes the comparison fair. Loan amount is ${money(r.loanAmount)}.</p>`);
}

// 6 ─ Monthly cost over time
function secMonthlyCostOverTime(r) {
  const s = monthlyCostSeries(inputs, r);
  const all = [...s.renter.map((d) => d.cost), ...s.owner.map((d) => d.cost)];
  const max = Math.max(...all), min = Math.min(...all) * 0.88, range = (max - min) || 1;
  const W = 640, H = 210, pad = 30;
  const X = (y) => pad + (y / 30) * (W - pad - 8);
  const Y = (v) => 12 + (H - 46) * (1 - (v - min) / range);
  const line = (pts, color) =>
    `<polyline fill="none" stroke="${color}" stroke-width="2.5" stroke-linejoin="round" points="${pts.map((d) => `${X(d.year).toFixed(1)},${Y(d.cost).toFixed(1)}`).join(' ')}"/>`;
  const ticks = [0, 10, 20, 30].map((y) => `<text x="${X(y)}" y="${H - 8}" text-anchor="middle" font-size="11" fill="var(--muted)">${y}y</text>`).join('');
  const cross = s.crossoverYear != null
    ? `<line x1="${X(s.crossoverYear)}" y1="8" x2="${X(s.crossoverYear)}" y2="${H - 34}" stroke="var(--text)" stroke-width="1" stroke-dasharray="3 3" opacity=".5"/>`
    : '';
  return section('Monthly cost over time', 'Not net worth: just what each side pays per month',
    `<div class="scroller"><svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Monthly cost of renting versus owning over thirty years">
      <line x1="${pad}" y1="${H - 34}" x2="${W - 8}" y2="${H - 34}" stroke="var(--line)"/>
      ${cross}${line(s.owner, 'var(--orange)')}${line(s.renter, 'var(--teal)')}${ticks}
    </svg></div>
    <div class="legend"><span><i style="background:var(--teal)"></i>Renting</span><span><i style="background:var(--orange)"></i>Owning</span></div>
    <p class="note">Rent compounds every year. Owning is flat and then steps down, once when PMI falls away and again when the mortgage is paid off.${
      s.crossoverYear != null ? ` The two cross at about year ${s.crossoverYear.toFixed(1)}, marked on the chart.` : ' On these assumptions the two never cross within thirty years.'}</p>`);
}

// 7 ─ Sensitivity
function secSensitivity() {
  const grid = sensitivityGrid(inputs, sensHorizon);
  const head = `<tr><th class="corner">Appreciation&nbsp;↓<br>Stock return&nbsp;→</th>${
    grid[0].cols.map((c) => `<th>${formatPercent(c.equityReturn)}</th>`).join('')}</tr>`;
  const rows = grid.map((row) => `<tr><th>${formatPercent(row.appreciation)}</th>${
    row.cols.map((c) => `<td class="cell ${c.rentWins ? 'r' : 'b'}${row.isCurrentApp && c.isCurrentEq ? ' here' : ''}">${c.rentWins ? 'Rent' : 'Buy'}</td>`).join('')
  }</tr>`).join('');
  const picker = `<div class="horizons" style="margin-bottom:12px">${
    HORIZONS.map((y) => `<button type="button" data-sens="${y}" aria-pressed="${y === sensHorizon}">${y === 1 ? '1 year' : `${y} years`}</button>`).join('')}</div>`;
  return section('Sensitivity analysis', 'Home appreciation against stock return, and who wins',
    picker + table(head, rows, 'sens') +
    `<div class="legend"><span><i style="background:var(--teal)"></i>Renting wins</span><span><i style="background:var(--orange)"></i>Buying wins</span><span>Outlined cell is your own assumption</span></div>
     <p class="note">Each step is one percentage point. If the colour changes in the cells next to yours, the answer is genuinely close and small changes in either rate would flip it.</p>`);
}

// 8 ─ Break-even appreciation
function secBreakEvenAppreciation(r) {
  const rows = r.periods.map((p) => `<tr${p.years === horizon ? ' class="is-current"' : ''}>
    <td>${yr(p.years)}</td><td>${formatPercent(p.breakEvenAppreciation)}</td>
    <td>${p.breakEvenAppreciation > inputs.appreciation ? 'Renting wins' : 'Buying wins'}</td></tr>`).join('');
  return section('Break-even appreciation', 'How fast the home must gain value for buying to win',
    table('<th>Horizon</th><th>Required</th><th>At your assumption</th>', rows) +
    `<p class="note">You assumed ${formatPercent(inputs.appreciation)} a year. Where the required rate is above that, renting wins at that horizon.</p>`);
}

// 9 ─ Break-even stock return
function secBreakEvenReturn(r) {
  const rows = r.periods.map((p) => `<tr${p.years === horizon ? ' class="is-current"' : ''}>
    <td>${yr(p.years)}</td><td>${formatPercent(p.breakEvenEquityReturn)}</td>
    <td>${p.breakEvenEquityReturn > inputs.equityReturn ? 'Buying wins' : 'Renting wins'}</td></tr>`).join('');
  return section('Break-even stock return', 'What the renter’s investments must earn to keep up',
    table('<th>Horizon</th><th>Required</th><th>At your assumption</th>', rows) +
    `<p class="note">You assumed ${formatPercent(inputs.equityReturn)} a year. Where the required return is above that, buying wins at that horizon.</p>`);
}

// 10 ─ Buyer net worth breakdown
function secBuyerBreakdown(r) {
  const rows = r.periods.map((p) => `<tr${p.years === horizon ? ' class="is-current"' : ''}>
    <td>${p.years}y</td><td>${compact(p.homeValue)}</td><td>${compact(-p.remainingMortgage)}</td>
    <td>${compact(p.homeEquity)}</td><td>${compact(p.investedTaxSavings)}</td>
    <td>${compact(p.ownerInvestedSavings)}</td><td class="buy"><strong>${compact(p.buyerNetWorth)}</strong></td></tr>`).join('');
  return section('Buyer net worth breakdown', 'Where the owner’s money ends up',
    table('<th>Horizon</th><th>Home value</th><th>Mortgage left</th><th>Equity</th><th>Invested tax saving</th><th>Invested monthly saving</th><th class="buy">Total</th>', rows) +
    `<p class="note">Equity is the down payment plus principal repaid plus appreciation. Invested monthly saving covers months where owning was cheaper than renting, invested at ${formatPercent(inputs.equityReturn)}.</p>`);
}

// 11 ─ Renter portfolio breakdown
function secRenterBreakdown(r) {
  const rows = r.periods.map((p) => `<tr${p.years === horizon ? ' class="is-current"' : ''}>
    <td>${p.years}y</td><td>${compact(p.renterInitialCompounded)}</td>
    <td>${compact(p.renterInvestedSavings)}</td><td class="rent"><strong>${compact(p.renterNetWorth)}</strong></td></tr>`).join('');
  return section('Renter portfolio breakdown', 'Where the renter’s money ends up',
    table('<th>Horizon</th><th>Down payment invested</th><th>Monthly savings invested</th><th class="rent">Total</th>', rows) +
    `<p class="note">The renter starts by investing the full ${money(r.initialInvestment)} the buyer spent on the down payment and closing costs, then adds the monthly difference whenever renting is cheaper.</p>`);
}

// 12 ─ Tax benefit breakdown
function secTaxBreakdown(r) {
  const rows = r.periods.map((p) => `<tr${p.years === horizon ? ' class="is-current"' : ''}>
    <td>${p.years}y</td><td>${compact(p.totalInterestPaid)}</td><td>${compact(p.totalPropTaxPaid)}</td>
    <td>${compact(p.itemizedDeductions)}</td><td>${compact(p.taxBenefit)}</td>
    <td>${money(p.monthlyTaxBenefit)}</td></tr>`).join('');
  return section('Tax benefit breakdown', 'What itemising is actually worth to the owner',
    table('<th>Horizon</th><th>Interest paid</th><th>Property tax paid</th><th>Itemised</th><th>Tax benefit</th><th>Per month</th>', rows) +
    `<p class="note">Only deductions above the ${money(inputs.standardDeduction)} standard deduction are worth anything, valued at your ${formatPercent(inputs.taxRate)} marginal rate. The benefit shrinks every year as the interest portion of the payment falls, which is why the monthly figure is an average rather than a constant.</p>`);
}

// ── Wiring ──────────────────────────────────────────────────────────────────

document.getElementById('inputs').addEventListener('input', (e) => {
  const el = e.target;
  if (!el.name || !(el.name in inputs)) return;
  const raw = parseFloat(el.value);
  if (!isFinite(raw)) return;              // mid-edit empty box: leave the model alone
  inputs[el.name] = el.dataset.kind === 'pct' ? raw / 100 : raw;
  saveInputs();
  render();
});

document.getElementById('reset').addEventListener('click', () => {
  inputs = { ...DEFAULT_INPUTS };
  saveInputs();
  renderInputs();
  render();
});

// Delegated so the buttons survive every re-render.
document.getElementById('results').addEventListener('click', (e) => {
  const h = e.target.closest('[data-horizon]');
  if (h) { horizon = Number(h.dataset.horizon); render(); return; }
  const s = e.target.closest('[data-sens]');
  if (s) {
    sensHorizon = Number(s.dataset.sens);
    render();
    // Keep the grid where the reader was looking instead of jumping to the top.
    document.querySelector('[data-sens]')?.closest('.sec')?.scrollIntoView({ block: 'nearest' });
  }
});

renderInputs();
render();
