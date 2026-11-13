<script setup>
import { computed } from 'vue';
const props = defineProps({ modelValue: Boolean });
const emit = defineEmits(['update:modelValue']);
const open = computed({ get: () => props.modelValue, set: value => emit('update:modelValue', value) });
</script>

<template>
  <el-dialog v-model="open" title="苹果手机安装不同版本教程" width="min(760px,96vw)" append-to-body>
    <div class="wz-tutorial-body">
      <p class="wz-tip">请注意：手机需要提前安装最新版本抖音，并且在抖音登录，否则旧版无法登录抖音号。</p>
      <p class="wz-tip">确保最新版抖音和旧版极数抖音同时在手机后台打开，否则旧版本登录的时候无法识别新版本的账号。</p>
      <p>流程：电脑先下载抖音安装包，安装后下载爱思助手，通过爱思助手把安装包安装到手机里。</p>
      <p>抖音下载地址：<a href="/card-assets/tutorial/douyin-lite-30.3.0.ipa" download>抖音极速版 30.3.0（适用于扫码分享卡片）</a></p>
      <h4>1：电脑安装“爱思助手”</h4>
      <p>爱思助手官网地址：<a href="https://www.i4.cn/" target="_blank" rel="noreferrer">https://www.i4.cn/</a></p>
      <p>点击爱思助手-立即下载，是 Win 系统就下载 Win 版本，是 Mac 系统就下载 Mac 版本。</p>
      <img src="/card-assets/tutorial/ios-1.jpg" alt="下载爱思助手"/>
      <h4>2：连接手机</h4>
      <p>1. 打开爱思助手，用手机数据线将手机和电脑连接。</p>
      <p>2. 确认手机已解锁并点信任电脑。</p>
      <img src="/card-assets/tutorial/ios-2.jpg" alt="连接手机"/>
      <h4>3：导入安装</h4>
      <p>我的设备 — 应用/应用游戏 — 导入安装。导入提前下载好的旧版安装包文件就会自动安装，等待传输安装完成就可以了。</p>
      <img src="/card-assets/tutorial/ios-3.jpg" alt="导入安装"/>
    </div>
  </el-dialog>
</template>

<style>
.wz-tutorial-body{max-height:70vh;overflow:auto;font-size:14px;line-height:1.8;color:#303133}
.wz-tutorial-body p{margin:4px 0}
.wz-tutorial-body h4{margin:16px 0 6px;font-size:15px}
.wz-tutorial-body .wz-tip{color:#f56c6c}
.wz-tutorial-body img{display:block;max-width:100%;margin:8px 0;border:1px solid #ebeef5;border-radius:6px}
</style>
