'use strict';
chrome.runtime.onMessage.addListener((message,sender)=>{
  if(message?.type!=='MCS_CAPTURE_COUNT'||!sender.tab?.id)return;
  if(!/^https:\/\/([a-z0-9-]+\.)?meshy\.ai\//i.test(sender.url||sender.tab.url||''))return;
  chrome.action.setBadgeBackgroundColor({color:'#0ca77d',tabId:sender.tab.id}).catch(()=>{});
  chrome.action.setBadgeText({text:message.count>0?String(Math.min(message.count,99)):'',tabId:sender.tab.id}).catch(()=>{});
});
