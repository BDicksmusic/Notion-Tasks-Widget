package com.notiontasks.widget.mobile;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import android.widget.RemoteViews;
import android.util.Log;

import org.json.JSONArray;
import org.json.JSONObject;

/**
 * Tasks home screen widget provider.
 * Displays a list of upcoming tasks from Notion.
 */
public class TasksWidgetProvider extends AppWidgetProvider {
    
    private static final String TAG = "TasksWidget";
    private static final String PREFS_NAME = "CapacitorStorage";
    private static final String TASKS_KEY = "mobile.local.tasks";
    private static final String ACTION_REFRESH = "com.notiontasks.widget.REFRESH_TASKS";
    private static final String ACTION_OPEN_APP = "com.notiontasks.widget.OPEN_APP";
    private static final String ACTION_ADD_TASK = "com.notiontasks.widget.ADD_TASK";
    
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
        if (ACTION_REFRESH.equals(action)) {
            // Refresh all widgets
            AppWidgetManager appWidgetManager = AppWidgetManager.getInstance(context);
            int[] appWidgetIds = appWidgetManager.getAppWidgetIds(
                new ComponentName(context, TasksWidgetProvider.class));
            onUpdate(context, appWidgetManager, appWidgetIds);
        } else if (ACTION_OPEN_APP.equals(action)) {
            // Open the main app
            Intent launchIntent = context.getPackageManager()
                .getLaunchIntentForPackage(context.getPackageName());
            if (launchIntent != null) {
                launchIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                context.startActivity(launchIntent);
            }
        } else if (ACTION_ADD_TASK.equals(action)) {
            // Open app to add task
            Intent launchIntent = context.getPackageManager()
                .getLaunchIntentForPackage(context.getPackageName());
            if (launchIntent != null) {
                launchIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                launchIntent.putExtra("action", "add_task");
                context.startActivity(launchIntent);
            }
        }
    }
    
    static void updateAppWidget(Context context, AppWidgetManager appWidgetManager, int appWidgetId) {
        RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.widget_tasks);
        
        // Set up header click to open app
        Intent openAppIntent = new Intent(context, TasksWidgetProvider.class);
        openAppIntent.setAction(ACTION_OPEN_APP);
        PendingIntent openAppPendingIntent = PendingIntent.getBroadcast(
            context, 0, openAppIntent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        views.setOnClickPendingIntent(R.id.widget_header, openAppPendingIntent);
        
        // Set up refresh button
        Intent refreshIntent = new Intent(context, TasksWidgetProvider.class);
        refreshIntent.setAction(ACTION_REFRESH);
        PendingIntent refreshPendingIntent = PendingIntent.getBroadcast(
            context, 1, refreshIntent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        views.setOnClickPendingIntent(R.id.widget_refresh_button, refreshPendingIntent);
        
        // Set up add button
        Intent addIntent = new Intent(context, TasksWidgetProvider.class);
        addIntent.setAction(ACTION_ADD_TASK);
        PendingIntent addPendingIntent = PendingIntent.getBroadcast(
            context, 2, addIntent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        views.setOnClickPendingIntent(R.id.widget_add_button, addPendingIntent);
        
        // Load tasks from SharedPreferences (Capacitor storage)
        try {
            SharedPreferences prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
            String tasksJson = prefs.getString(TASKS_KEY, "[]");
            JSONArray tasks = new JSONArray(tasksJson);
            
            // Clear existing task views
            views.removeAllViews(R.id.widget_tasks_container);
            
            // Add task views (show up to 5 tasks)
            int count = Math.min(tasks.length(), 5);
            for (int i = 0; i < count; i++) {
                JSONObject task = tasks.getJSONObject(i);
                String title = task.optString("title", "Untitled");
                String status = task.optString("status", "");
                String dueDate = task.optString("dueDate", "");
                boolean isUrgent = task.optBoolean("urgent", false);
                boolean isImportant = task.optBoolean("important", false);
                
                RemoteViews taskView = new RemoteViews(context.getPackageName(), R.layout.widget_task_item);
                taskView.setTextViewText(R.id.task_title, title);
                
                // Build subtitle
                StringBuilder subtitle = new StringBuilder();
                if (!dueDate.isEmpty()) {
                    // Format date simply
                    subtitle.append("📅 ").append(formatDate(dueDate));
                }
                if (isUrgent) subtitle.append(" 🔥");
                if (isImportant) subtitle.append(" ⭐");
                
                if (subtitle.length() > 0) {
                    taskView.setTextViewText(R.id.task_subtitle, subtitle.toString());
                } else {
                    taskView.setTextViewText(R.id.task_subtitle, status);
                }
                
                // Add click handler to open app
                taskView.setOnClickPendingIntent(R.id.task_item_container, openAppPendingIntent);
                
                views.addView(R.id.widget_tasks_container, taskView);
            }
            
            // Show empty state if no tasks
            if (count == 0) {
                RemoteViews emptyView = new RemoteViews(context.getPackageName(), R.layout.widget_task_item);
                emptyView.setTextViewText(R.id.task_title, "No tasks");
                emptyView.setTextViewText(R.id.task_subtitle, "Tap + to add one");
                views.addView(R.id.widget_tasks_container, emptyView);
            }
            
            // Update task count
            views.setTextViewText(R.id.widget_task_count, tasks.length() + " tasks");
            
        } catch (Exception e) {
            Log.e(TAG, "Error loading tasks", e);
            views.setTextViewText(R.id.widget_task_count, "Error loading tasks");
        }
        
        appWidgetManager.updateAppWidget(appWidgetId, views);
    }
    
    private static String formatDate(String isoDate) {
        try {
            // Simple date formatting - just extract month and day
            if (isoDate.length() >= 10) {
                String[] parts = isoDate.substring(0, 10).split("-");
                if (parts.length >= 3) {
                    String[] months = {"Jan", "Feb", "Mar", "Apr", "May", "Jun", 
                                       "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"};
                    int month = Integer.parseInt(parts[1]) - 1;
                    int day = Integer.parseInt(parts[2]);
                    if (month >= 0 && month < 12) {
                        return months[month] + " " + day;
                    }
                }
            }
        } catch (Exception e) {
            // Ignore formatting errors
        }
        return isoDate;
    }
}



