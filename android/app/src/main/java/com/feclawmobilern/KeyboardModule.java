package com.feclawmobilern;

import android.app.Activity;
import android.view.View;
import android.view.inputmethod.InputMethodManager;

import androidx.annotation.NonNull;

import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.bridge.ReactContextBaseJavaModule;
import com.facebook.react.bridge.ReactMethod;

/**
 * Native keyboard helper.
 *
 * 一些 Android 机型 / WebView 组合下，react-native-webview 的 requestFocus +
 * JS focus 都无法唤起系统软键盘（焦点虽然在 WebView 内但 IMM 没弹起）。
 * RN 层通过 NativeModules.KeyboardModule.show() 显式拉一次 IMM.showSoftInput
 * 作为兜底。
 *
 * 必须在 UI 线程上调用。
 */
public class KeyboardModule extends ReactContextBaseJavaModule {

    public KeyboardModule(ReactApplicationContext reactContext) {
        super(reactContext);
    }

    @NonNull
    @Override
    public String getName() {
        return "KeyboardModule";
    }

    @ReactMethod
    public void show() {
        final Activity activity = getCurrentActivity();
        if (activity == null) return;
        activity.runOnUiThread(new Runnable() {
            @Override
            public void run() {
                View view = activity.getCurrentFocus();
                if (view == null) return;
                InputMethodManager imm = (InputMethodManager) activity.getSystemService(
                        Activity.INPUT_METHOD_SERVICE
                );
                if (imm == null) return;
                imm.showSoftInput(view, InputMethodManager.SHOW_FORCED);
            }
        });
    }
}
