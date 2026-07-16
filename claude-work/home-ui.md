# FeClaw-Mobile: Zentrim 首页 UI

项目: /home/lch/Projects/FeClaw-Mobile

## 重要背景
这是 Zentrim（格物所）App 的首页，一个 AI 速记工具。不是聊天App！
当前 App.tsx 直接渲染 CanvasScreen（画布编辑）。需要加导航和首页。

## 需要安装的依赖
npm install @react-navigation/native @react-navigation/bottom-tabs react-native-screens react-native-safe-area-context

## 要创建的文件

### 1. src/screens/HomeScreen.tsx
Zentrim 主页，上下布局：
- 顶部: "☀️ 早上好，今天有物理课"（问候语，随时间变化）
- "💡 你有一段录音提到了 Kimi K2.7"（浅灰小字，点击弹出Modal）
- 三张白色圆角卡片并排（flex: 1）：📋待办(3未完成) | 📈完成度(2待回顾) | 📅全部(12条笔记)
- 预留空间
- 底部居中: 蓝色圆形 ＋ 按钮（点 → 导航到 CanvasScreen）
- 背景色 #F5F5F0，卡片白底 #FFF

"注意到" Modal:
- 点击💡文字弹出，半透明遮罩 + 居中白底浮窗
- 内容："AI 模型调研 · 07-01"，三个按钮："展开看看"、"加入附录"、"OK"

时间线 Sheet（点卡片弹出）：
- 从底部滑入，标题"📅 全部笔记" + ✕关闭
- 以下模拟数据：
  - 07-09: 📷 化学试卷批改 ✓已处理, 🎙️ 英语课堂录音 ⏳转换中
  - 07-08: 📝 三角函数总结
- 点条目 → 跳转 CanvasScreen

### 2. src/screens/ChatTab.tsx
占位页，居中显示"💬 聊天"文字。

### 3. src/navigation/AppNavigator.tsx
底部双Tab导航: "💬 聊天" | "📦 Zentrim"
点＋ → navigate到 CanvasScreen（使用现有的 ZentrimCanvas）

### 4. 更新 App.tsx
用 AppNavigator 替换直接渲染 CanvasScreen。

## 注意事项
- 不修改 src/canvas/ 下的任何文件
- CanvasScreen 直接用现有的，不要改它
- 所有数据用 mock 常量，不走网络
- 纯 UI 组件，不需要后端 API
- 运行 npx tsc --noEmit 确认无类型错误
- 用 @react-navigation/native + @react-navigation/bottom-tabs
- Stack Navigator 注册: Main(tabs) → Canvas(全屏)
- Canvas 在导航栈中

完成后结果写入 claude-work/home-ui-result.md。
