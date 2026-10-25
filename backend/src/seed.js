// Creates the default accounts and chambers on first run (idempotent).
const store = require('./store');
const { hashPassword } = require('./auth');

const last4 = (id) => String(id).slice(-4);

module.exports = function seed() {
  const now = new Date().toISOString();
  const accounts = [
    { empId: '000001', name: 'ผู้ดูแลระบบ', dept: 'IT', role: 'admin' },
    { empId: '200001', name: 'สมชาย ใจดี', dept: 'R&D', role: 'requester' },
  ];
  accounts.forEach((a) => {
    if (!store.get('employees', a.empId)) {
      store.set('employees', a.empId, {
        empId: a.empId, name: a.name, dept: a.dept, role: a.role,
        passwordHash: hashPassword(last4(a.empId)), createdAt: now,
      });
    }
  });

  if (store.list('chambers').length === 0) {
    [
      { name: 'Chamber CH-01', setPoint: 85 },
      { name: 'Chamber CH-02', setPoint: -40 },
      { name: 'Chamber CH-03', setPoint: 60 },
      { name: 'Chamber CH-04', setPoint: 25 },
      { name: 'Vibration Rig VB-01', setPoint: 0 },
      { name: 'Humidity Cab HM-01', setPoint: 40 },
    ].forEach((c) => store.add('chambers', { ...c, status: 'idle', requestId: null, requestNo: null }));
  }
};
