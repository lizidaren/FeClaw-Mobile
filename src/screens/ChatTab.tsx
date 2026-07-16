import React from "react";
import { StyleSheet, Text, View } from "react-native";

export function ChatTab() {
  return (
    <View style={styles.root}>
      <Text style={styles.text}>💬 聊天</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#F5F5F0",
  },
  text: {
    fontSize: 18,
    color: "#666",
  },
});
