package com.notiontasks.widget.mobile;

import com.getcapacitor.BridgeActivity;
import android.webkit.WebView;
import android.content.Intent;
import android.os.Bundle;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import android.util.Log;

public class MainActivity extends BridgeActivity {

  private String pendingAction = null;

  @Override
  public void onCreate(Bundle savedInstanceState) {
    super.onCreate(savedInstanceState);
    handleIntent(getIntent());
  }

  @Override
  protected void onNewIntent(Intent intent) {
    super.onNewIntent(intent);
    handleIntent(intent);
  }

  private void handleIntent(Intent intent) {
    if (intent != null) {
      String action = intent.getStringExtra("action");
      if (action != null) {
        pendingAction = action;
        Log.d("MainActivity", "Received action from widget: " + action);
      }
    }
  }

  @Override
  public void onStart() {
    super.onStart();
    WebView webView = getBridge().getWebView();
    try {
        InputStream inputStream = getAssets().open("js/shim.js");
        byte[] buffer = new byte[inputStream.available()];
        inputStream.read(buffer);
        inputStream.close();
        String js = new String(buffer, StandardCharsets.UTF_8);
        webView.evaluateJavascript(js, null);
        
        // If there's a pending action from a widget, inject it
        if (pendingAction != null) {
          String actionJs = "window.__WIDGET_ACTION__ = '" + pendingAction + "';";
          webView.evaluateJavascript(actionJs, null);
          Log.d("MainActivity", "Injected widget action: " + pendingAction);
          pendingAction = null;
        }
    } catch (Exception e) {
        Log.e("MainActivity", "Error injecting shim.js", e);
    }
  }
}
