import { createApp } from 'vue';
import ElementPlus from 'element-plus';
import zhCn from 'element-plus/es/locale/lang/zh-cn';
import 'element-plus/dist/index.css';
import './style.css';
import App from './App.vue';
import CardLanding from './modules/cards/CardLanding.vue';

// 扫码落地页（/?card=<id>）无需登录，直接渲染公开页面。
const cardId = new URLSearchParams(window.location.search).get('card');
if (cardId && /^[\w-]{8,64}$/.test(cardId)) createApp(CardLanding, { id: cardId }).mount('#app');
else createApp(App).use(ElementPlus, { locale: zhCn }).mount('#app');
