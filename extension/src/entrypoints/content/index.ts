import { defineContentScript } from 'wxt/utils/define-content-script';
import { startContentScript } from '../../content';
import './style.css';

export default defineContentScript({
  matches: ['<all_urls>'],
  allFrames: true,
  matchAboutBlank: true,
  runAt: 'document_end',
  main: startContentScript,
});
