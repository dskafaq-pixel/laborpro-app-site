/* Small, app-specific safety fixes loaded after LaborPro's main script. */
(function () {
  'use strict';

  function install() {
    if (typeof D === 'undefined' || typeof U === 'undefined' || typeof N === 'undefined') return false;

    // Use the device's local calendar date; toISOString() can report yesterday
    // in time zones east of UTC during the early morning.
    U.td = function () {
      const now = new Date();
      const pad = value => String(value).padStart(2, '0');
      return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
    };

    const calculateSalary = window.calcSingleSalary;
    if (typeof calculateSalary === 'function' && !calculateSalary.__laborProGuarded) {
      const guardedCalculateSalary = function (laborId, month) {
        const existing = D.g('salaries').find(s => s.lid === laborId && s.month === month);
        if (existing && (existing.paid || D.g('payments').some(p => p.vno === `SAL-${existing.id}`))) {
          N.w('This salary already has a payment record. Reconcile it before recalculating.');
          return;
        }
        const retained = existing ? {
          otherDeductions: Number(existing.otherDeductions) || 0,
          advance: Number(existing.advance) || 0
        } : null;
        calculateSalary(laborId, month);
        if (!retained) return;
        const updated = D.g('salaries').find(s => s.lid === laborId && s.month === month);
        if (!updated) return;
        D.upd('salaries', updated.id, {
          ...retained,
          netSalary: (Number(updated.netSalary) || 0) - retained.otherDeductions - retained.advance
        });
        if (typeof window.renderSal === 'function') window.renderSal();
      };
      guardedCalculateSalary.__laborProGuarded = true;
      window.calcSingleSalary = guardedCalculateSalary;
    }

    const markPaid = window.markSalPaid;
    if (typeof markPaid === 'function' && !markPaid.__laborProGuarded) {
      const guardedMarkPaid = function (laborId, month) {
        const salary = D.g('salaries').find(s => s.lid === laborId && s.month === month);
        if (!salary) return;
        if (salary.paid || D.g('payments').some(p => p.vno === `SAL-${salary.id}`)) {
          N.w('This salary already has a payment record.');
          return;
        }
        return markPaid(laborId, month);
      };
      guardedMarkPaid.__laborProGuarded = true;
      window.markSalPaid = guardedMarkPaid;
    }

    const payAll = window.payAllSalaries;
    if (typeof payAll === 'function' && !payAll.__laborProGuarded) {
      window.payAllSalaries = function () {
        const month = document.getElementById('sal_ym')?.value || U.ms().slice(0, 7);
        const unpaid = D.g('salaries').filter(s => s.month === month && !s.paid &&
          !D.g('payments').some(p => p.vno === `SAL-${s.id}`));
        if (!unpaid.length) {
          N.w('No unpaid salaries');
          return;
        }
        cfm(`Pay ${unpaid.length} salaries totaling ${U.fc(unpaid.reduce((sum, s) => sum + (Number(s.netSalary) || 0), 0))}?`, () => {
          let paidCount = 0;
          unpaid.forEach(item => {
            const current = D.g('salaries').find(s => s.id === item.id);
            if (!current || current.paid || D.g('payments').some(p => p.vno === `SAL-${current.id}`)) return;
            D.upd('salaries', current.id, { paid: true, paidDate: U.td(), paidMethod: 'Cash' });
            D.add('payments', { date: U.td(), vno: `SAL-${current.id}`, lid: current.lid,
              am: current.netSalary, method: 'Cash', rem: `Monthly salary ${month}` });
            paidCount++;
          });
          if (paidCount) {
            AU.log('Pay All Salaries', `${paidCount} salaries`);
            N.s(`${paidCount} salaries paid`);
          } else N.w('No unpaid salaries');
          renderSal();
        });
      };
      window.payAllSalaries.__laborProGuarded = true;
    }
    return true;
  }

  if (!install()) window.addEventListener('load', install, { once: true });
})();
