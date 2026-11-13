import { createApp } from 'vue'
import App from './App.vue'
import './style.css'
import { installTauriBridge } from './desktop/tauri'

async function boot() {
  try {
    await installTauriBridge()
  } catch (error) {
    console.error('桌面接口初始化失败：', error)
  }
  createApp(App).mount('#app')
}
void boot()
