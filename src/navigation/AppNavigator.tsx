/**
 * App 根导航器
 *
 * 结构（登录态切换两个独立 Stack，避免 Stack 在登录前后重建）：
 *   isLoggedIn === true:
 *     Stack
 *     ├── Main (TabNavigator)
 *     │   ├── ChatTab       "💬 聊天"      ← ChatListScreen
 *     │   └── ZentrimTab    "📦 Zentrim"   ← HomeScreen
 *     ├── ChatSession                    (Stack 顶层，私聊 / 多 Agent)
 *     ├── GroupChatSession               (Stack 顶层，群聊)
 *     └── Canvas                         (modal 风格全屏)
 *
 *   isLoggedIn === false:
 *     Stack
 *     └── Login (单页)
 */

import React from "react";
import { NavigationContainer } from "@react-navigation/native";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { createNativeStackNavigator } from "@react-navigation/native-stack";

import { HomeScreen } from "../screens/HomeScreen";
import { ChatListScreen } from "../screens/ChatListScreen";
import { ChatSessionScreen } from "../screens/ChatSessionScreen";
import { GroupChatSessionScreen } from "../screens/GroupChatSessionScreen";
import { CanvasScreen } from "../screens/CanvasScreen";
import { CreateAgentScreen } from "../screens/CreateAgentScreen";
import { LoginScreen } from "../screens/LoginScreen";

/** 底部 Tab 路由表 */
export type TabParamList = {
  ChatTab: undefined;
  ZentrimTab: undefined;
};

/** ChatSession 入参：null 表示新会话 */
export type ChatSessionParams = {
  sessionId: string | null;
};

/** GroupChatSession 入参：群 id */
export type GroupChatSessionParams = {
  groupId: string;
};

/** 已登录主 Stack 路由表 */
export type RootStackParamList = {
  Main: undefined;
  ChatSession: ChatSessionParams;
  GroupChatSession: GroupChatSessionParams;
  /** Canvas 页：传 entryId 打开已有条目；不传 → 新建空白画布 */
  Canvas: { entryId?: string } | undefined;
  /** 创建 AI 向导：模板选择 + 手动输入两种模式 */
  CreateAgent: undefined;
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
        component={ChatListScreen}
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
        name="ChatSession"
        component={ChatSessionScreen}
        options={{ presentation: "card" }}
      />
      <Stack.Screen
        name="GroupChatSession"
        component={GroupChatSessionScreen}
        options={{ presentation: "card" }}
      />
      <Stack.Screen
        name="Canvas"
        component={CanvasScreen}
        options={{ presentation: "fullScreenModal" }}
      />
      <Stack.Screen
        name="CreateAgent"
        component={CreateAgentScreen}
        options={{ presentation: "card" }}
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