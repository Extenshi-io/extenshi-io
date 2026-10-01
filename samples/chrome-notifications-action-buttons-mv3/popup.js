'use strict';

const ALARM_NAME = 'standup-reminder';

function setAlarm(event) {
  const minutes = parseFloat(event.target.value);
  chrome.storage.sync.set({ intervalMinutes: minutes });
  chrome.alarms.create(ALARM_NAME, { delayInMinutes: minutes });
  chrome.action.setBadgeText({ text: 'ON' });
  window.close();
}

function cancelAlarm() {
  chrome.alarms.clear(ALARM_NAME);
  chrome.action.setBadgeText({ text: '' });
  window.close();
}

for (const id of ['min1', 'min15', 'min30']) {
  document.getElementById(id).addEventListener('click', setAlarm);
}
document.getElementById('cancel').addEventListener('click', cancelAlarm);
