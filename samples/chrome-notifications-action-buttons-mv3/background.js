'use strict';

const ALARM_NAME = 'standup-reminder';
const NOTIFICATION_ID = 'reminder:standup';
const ICON_URL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAIAAAD8GO2jAAAAKklEQVR42mP4HS1FU8QwasGoBaMWjFowasGoBaMWjFowasGoBaMWDBULAJtPwExLeGOBAAAAAElFTkSuQmCC';

// Top-level listeners: registered on the worker's first turn, every boot.

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name !== ALARM_NAME) return;
  chrome.action.setBadgeText({ text: '!' });
  chrome.notifications.create(NOTIFICATION_ID, {
    type: 'basic',
    iconUrl: ICON_URL,
    title: 'Stand-up time',
    message: 'Stretch, grab water, look at something far away.',
    contextMessage: 'Stand-up Reminder',
    buttons: [{ title: 'Done' }, { title: 'Snooze 5 min' }],
    priority: 2,
    requireInteraction: true,
  });
});

chrome.notifications.onButtonClicked.addListener(async (notificationId, buttonIndex) => {
  if (!notificationId.startsWith('reminder:')) return;
  const intent = buttonIndex === 0 ? 'done' : 'snooze';
  chrome.notifications.clear(notificationId);

  if (intent === 'snooze') {
    chrome.alarms.create(ALARM_NAME, { delayInMinutes: 5 });
    return;
  }
  // 'done': re-arm with the interval the user picked, read fresh from storage.
  const { intervalMinutes = 30 } = await chrome.storage.sync.get('intervalMinutes');
  chrome.action.setBadgeText({ text: 'ON' });
  chrome.alarms.create(ALARM_NAME, { delayInMinutes: intervalMinutes });
});

chrome.notifications.onClosed.addListener((notificationId) => {
  if (notificationId === NOTIFICATION_ID) {
    chrome.action.setBadgeText({ text: '' });
  }
});
