package com.notiontasks.widget.mobile;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.widget.RemoteViews;
import android.util.Log;

/**
 * Quick Capture home screen widget provider.
 * Provides quick access to add tasks or writing entries.
 */
public class QuickCaptureWidgetProvider extends AppWidgetProvider {
    
    private static final String TAG = "QuickCaptureWidget";
    private static final String ACTION_QUICK_TASK = "com.notiontasks.widget.QUICK_TASK";
    private static final String ACTION_QUICK_WRITING = "com.notiontasks.widget.QUICK_WRITING";
    private static final String ACTION_OPEN_APP = "com.notiontasks.widget.OPEN_CAPTURE_APP";
    
    @Override
    public void onUpdate(Context context, AppWidgetManager appWidgetManager, int[] appWidgetIds) {
        for (int appWidgetId : appWidgetIds) {
            updateAppWidget(context, appWidgetManager, appWidgetId);
        }
    }
    
    @Override
    public void onReceive(Context context, Intent intent) {
        super.onReceive(context, intent);
        
        String action = intent.getAction();
        Intent launchIntent = context.getPackageManager()
            .getLaunchIntentForPackage(context.getPackageName());
            
        if (launchIntent == null) return;
        launchIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        
        if (ACTION_QUICK_TASK.equals(action)) {
            launchIntent.putExtra("action", "quick_task");
            context.startActivity(launchIntent);
        } else if (ACTION_QUICK_WRITING.equals(action)) {
            launchIntent.putExtra("action", "quick_writing");
            context.startActivity(launchIntent);
        } else if (ACTION_OPEN_APP.equals(action)) {
            context.startActivity(launchIntent);
        }
    }
    
    static void updateAppWidget(Context context, AppWidgetManager appWidgetManager, int appWidgetId) {
        RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.widget_quick_capture);
        
        // Quick Task button
        Intent quickTaskIntent = new Intent(context, QuickCaptureWidgetProvider.class);
        quickTaskIntent.setAction(ACTION_QUICK_TASK);
        PendingIntent quickTaskPendingIntent = PendingIntent.getBroadcast(
            context, 10, quickTaskIntent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        views.setOnClickPendingIntent(R.id.quick_task_button, quickTaskPendingIntent);
        
        // Quick Writing button
        Intent quickWritingIntent = new Intent(context, QuickCaptureWidgetProvider.class);
        quickWritingIntent.setAction(ACTION_QUICK_WRITING);
        PendingIntent quickWritingPendingIntent = PendingIntent.getBroadcast(
            context, 11, quickWritingIntent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        views.setOnClickPendingIntent(R.id.quick_writing_button, quickWritingPendingIntent);
        
        // Header click to open app
        Intent openAppIntent = new Intent(context, QuickCaptureWidgetProvider.class);
        openAppIntent.setAction(ACTION_OPEN_APP);
        PendingIntent openAppPendingIntent = PendingIntent.getBroadcast(
            context, 12, openAppIntent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        views.setOnClickPendingIntent(R.id.capture_header, openAppPendingIntent);
        
        appWidgetManager.updateAppWidget(appWidgetId, views);
    }
}


