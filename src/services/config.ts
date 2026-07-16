/**
 * API 配置
 *
 * 开发时连本地后端（localhost:8080），生产环境切到 feclaw.lizidaren.cn。
 * __DEV__ 是 React Native 提供的编译期常量：__DEV__ === true 在 debug 构建中。
 */

export const API_CONFIG = {
  BASE_URL: __DEV__
    ? "http://192.168.0.10:8080"
    : "https://feclaw.lizidaren.cn",
} as const;
