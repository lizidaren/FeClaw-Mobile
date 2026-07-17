import React, { useEffect, useState } from "react";
import { ActivityIndicator, StatusBar, Text, View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { AppNavigator } from "./src/navigation/AppNavigator";
import { authStore, useAuth } from "./src/services/auth-store";
import { zentrimStore } from "./src/services/zentrim-store";
import { chatStore } from "./src/services/chat-store";

/** 根组件：负责启动时恢复 token，再根据登录态选择渲染 Login 或主导航 */
const App: React.FC = () => {
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    authStore.hydrate().then(() => setHydrated(true));
  }, []);

  const isLoggedIn = useAuth();

  // hydrate 完成后才显示页面（避免一闪登录页）
  if (!hydrated) {
    return (
      <View style={{ flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: "#F5F5F0" }}>
        <ActivityIndicator size="large" color="#1976d2" />
        <Text style={{ marginTop: 16, color: "#999", fontSize: 14 }}>初始化中...</Text>
      </View>
    );
  }

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <StatusBar barStyle="dark-content" backgroundColor="#F5F5F0" />
        <RootRouter isLoggedIn={isLoggedIn} />
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
};

/** 根据登录态选 navigator（避免把 navigator 写在条件内导致 Stack 重建） */
function RootRouter({ isLoggedIn }: { isLoggedIn: boolean }) {
  useEffect(() => {
    // 登出时清空 zentrim / chat 缓存，避免下个用户看到上一位的数据
    if (!isLoggedIn) {
      zentrimStore.reset();
      chatStore.reset();
    }
  }, [isLoggedIn]);

  return <AppNavigator isLoggedIn={isLoggedIn} />;
}

export default App;
