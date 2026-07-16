/**
 * App 根导航器
 *
 * 结构（登录态切换两个独立 Stack，避免 Stack 在登录前后重建）：
 *   isLoggedIn === true:
 *     Stack
 *     ├── Main (TabNavigator)
 *     │   ├── ChatTab   "💬 聊天"
 *     │   └── ZentrimTab "📦 Zentrim"  ← 渲染 HomeScreen
 *     └── Canvas          (modal 风格全屏)
 *
 *   isLoggedIn === false:
 *     Stack
 *     └── Login (单页)
 *
 * 点 HomeScreen 底部 + 按钮 → navigation.navigate("Canvas")
 */

import React from "react";
import { NavigationContainer } from "@react-navigation/native";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { createNativeStackNavigator } from "@react-navigation/native-stack";

import { HomeScreen } from "../screens/HomeScreen";
import { ChatTab } from "../screens/ChatTab";
import { CanvasScreen } from "../screens/CanvasScreen";
import { LoginScreen } from "../screens/LoginScreen";

/** 底部 Tab 路由表 */
export type TabParamList = {
  ChatTab: undefined;
  ZentrimTab: undefined;
};

/** 已登录主 Stack 路由表 */
export type RootStackParamList = {
  Main: undefined;
  Canvas: undefined;
};

/** 未登录 Stack 路由表 */
export type AuthStackParamList = {
  Login: undefined;
};

const Tab = createBottomTabNavigator<TabParamList>();
const Stack = createNativeStackNavigator<RootStackParamList>();
const AuthStack = createNativeStackNavigator<AuthStackParamList>();

function MainTabs() {
  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: "#1976d2",
        tabBarInactiveTintColor: "#888",
      }}
    >
      <Tab.Screen
        name="ChatTab"
        component={ChatTab}
        options={{ tabBarLabel: "💬 聊天" }}
      />
      <Tab.Screen
        name="ZentrimTab"
        component={HomeScreen}
        options={{ tabBarLabel: "📦 Zentrim" }}
      />
    </Tab.Navigator>
  );
}

function MainNavigator() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="Main" component={MainTabs} />
      <Stack.Screen
        name="Canvas"
        component={CanvasScreen}
        options={{ presentation: "fullScreenModal" }}
      />
    </Stack.Navigator>
  );
}

function AuthNavigator() {
  return (
    <AuthStack.Navigator screenOptions={{ headerShown: false }}>
      <AuthStack.Screen name="Login" component={LoginScreen} />
    </AuthStack.Navigator>
  );
}

export function AppNavigator({ isLoggedIn }: { isLoggedIn: boolean }) {
  return (
    <NavigationContainer key={isLoggedIn ? "main" : "auth"}>
      {isLoggedIn ? <MainNavigator /> : <AuthNavigator />}
    </NavigationContainer>
  );
}
