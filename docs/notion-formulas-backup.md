# Notion Formula Backup

These formulas were removed from the Notion database to improve API query performance (reduce 504 timeouts). They can be re-implemented in the application backend and synced back to Notion as computed properties.

## Formula 1: Time Tracking Summary

**Purpose**: Displays total time tracked, sessions, completions, and goal progress

**Formula**:
```notion
lets(
	AllStatuses,
	prop("Sub-Actions").map(current.prop("Status")).flat().join("," + prop("Status")),
	
	CurrentTimeLog,
	prop("Time Log"),
	
	SubItemTimeLog,
	prop("Sub-Actions").map(current.prop("Time Log")).flat(),
	
	RecurTrackingAll,
		prop("Recur Tracking").map(current.prop("Time Log")).flat(),
		
		SubRecurTrackingAll,
			prop("Sub-Actions").map(current.prop("Recur Tracking")).flat().map(current.prop("Time Log")).flat(),
	
	RecurTrackingCurrentSubLog,
			prop("Recur Tracking").map(current.prop("Time Log").filter(!current.prop("Task Done!"))).flat(),
			
			RecurTrackingSubfromMainLog,
			prop("Sub-Actions").map(current.prop("Recur Tracking")).flat().map(current.prop("Time Log").filter(!current.prop("Task Done!"))).flat().unique(),
	
	TotalCurrentTime,
CurrentTimeLog.concat(SubItemTimeLog).concat(RecurTrackingCurrentSubLog).concat(RecurTrackingSubfromMainLog).flat().unique(),
	
	TotalAllTime,
CurrentTimeLog.concat(SubItemTimeLog).concat(RecurTrackingAll).concat(SubRecurTrackingAll).flat().unique(),
	
	TimeSwitch,
	ifs(prop("Tracking Switch").contains("Current"),
		TotalCurrentTime.map(current.prop("logged time (min)")).sum(),
		prop("Tracking Switch").contains("All"),
		TotalAllTime.map(current.prop("logged time (min)")).sum()),
	
	TimeConversions,
if(TimeSwitch.toNumber()>60,
	(round((TimeSwitch/60) * 100)/100).format().split(".").first().toNumber()
	 + "hr(s) " + round(((round((TimeSwitch/60) * 100)/100).format().split(".").last().toNumber() /100) * 60) + "min",
	TimeSwitch + "min"),

	
	SessionsSwitch,
		ifs(prop("Tracking Switch").contains("Current"),
		TotalCurrentTime.filter(current.prop("Status").contains("End") and !current.prop("Sub-item")).length(),
		prop("Tracking Switch").contains("All"),
		TotalAllTime.filter(current.prop("Status").contains("End") and !current.prop("Sub-item")).length()),
		
		Completions,
		prop("Recur Tracking").length(),
		
			GoalTotal,
		ifs(prop("Goal (min or hrs?)").contains("hours"),
		prop("Goal Number") * 60,
		prop("Goal Number")) -
	TotalAllTime.unique().map(current.prop("logged time (min)")).sum()
	,
	
		
("Total Time:".style("b","u") + " " + TimeConversions).style(
	if(AllStatuses.contains("⌚") or prop("Status").contains("⌚"),
	"purple",
	""),
		if(AllStatuses.contains("⌚") or prop("Status").contains("⌚"),
	"u",
	"")) + "
" +
("# of Sessions:".style("b","u") + " " + SessionsSwitch + " Sess."
) + 

if(RecurTrackingAll.empty(),
	"",
"
" + ("# of Completions:".style("b","u") + " " + Completions + " ✅"
))

+ ifs(prop("Goal Number").empty(),
	"",
"
"
+ "Left Until Goal: ".style("b","u") + 
	
	ifs(GoalTotal>60,
		round((GoalTotal/60) *100)/100 + "hrs",
		GoalTotal + "min")
		)
	)

____________________

if(prop("Completion Time").empty(),
	"Not Completed".style("b","u","c","orange","red_background"),
"Completion Date: ".style("u","b") + "
" + prop("Completion Time").format().style("c","b","green","green_background")) + "
First Due Date: ".style("u","b") + "
" + 	if(prop("First Due Date").empty(),
			prop("Created time").formatDate("MMMM D, Y"),
			prop("First Due Date")).format().style("b","c","yellow") + "
Lateness: ".style("u","b")  + "
" + 

if(prop("Completion Time").empty(),
	(today().dateBetween(
		if(prop("First Due Date").empty(),
			prop("Created time"),
			prop("First Due Date")),"Days") + " Days").format().style("b","c"),
(prop("Completion Time").dateBetween(	if(prop("First Due Date").empty(),
			prop("Created time"),
			prop("First Due Date")),"Days") + " Days").format().style("b","c")
)

___________________________________

lets(

SessionLengthConv,
ifs(
	prop("Sess. (min or hrs?)").lower().contains("hour"),
	prop("Sess. Length") *60,
		prop("Sess. (min or hrs?)").lower().contains("min"),
	prop("Sess. Length")),
	
	SessionStartTime,
	prop("Time Log").sort(current.prop("Created time")).map(current.prop("Start Time")).last(),
	
	SessionEstEndTime,
prop("Time Log").sort(current.prop("Created time")).map(current.prop("Estimated End Time")).last(),
	
	SessionEndTime,
	prop("Time Log").sort(current.prop("Created time")).map(current.prop("End Time")).last(),
	
	CurrentSessionTimes,
	ifs(prop("Status").contains("⌚"),
		
		dateRange(SessionStartTime,SessionEstEndTime),
		
		prop("Status").contains("✅"),
		if(SessionEndTime.empty() or SessionStartTime.empty(),
			"",
		dateRange(SessionStartTime,SessionEndTime)),
		prop("Status").contains("📋") or prop("Status").contains("📥"),
		dateRange(now(),now().dateAdd(prop("Sess. Length") *
			 if(prop("Sess. (min or hrs?)").contains("hours"),
						60,
							1)
			,"minutes") 
		
			)),
	
	LeftinSession,
	ifs(
	prop("Status").contains("⌚"),
		
		dateBetween(SessionEstEndTime,now(),"minutes"),
		
		prop("Status").contains("✅"),
		dateBetween(SessionEndTime,SessionStartTime,"minutes"),
		prop("Status").contains("📋"),
		SessionLengthConv),
		
		LeftSessConv,
		ifs(LeftinSession>60,
		round((LeftinSession/60) *100) /100 + "hrs",
		LeftinSession + "min"),
		
AllStatuses,
	prop("Sub-Actions").map(current.prop("Status")).flat().join("," + prop("Status")),
	
	CurrentTimeLog,
	prop("Time Log").flat(),
	
	SubItemTimeLog,
	prop("Sub-Actions").map(current.prop("Time Log")).flat(),
	
	RecurTrackingAll,
		prop("Recur Tracking").map(current.prop("Time Log")).flat(),
		
		SubRecurTrackingAll,
			prop("Sub-Actions").map(current.prop("Recur Tracking")).flat().map(current.prop("Time Log")).flat(),
	
	RecurTrackingCurrentSubLog,
			prop("Recur Tracking").map(current.prop("Time Log")).flat().filter(!current.prop("Task Done!")).flat(),
			
			RecurTrackingSubfromMainLog,
			prop("Sub-Actions").map(current.prop("Recur Tracking")).flat().map(current.prop("Time Log")).flat().filter(!current.prop("Task Done!")).flat(),
	
	TotalCurrentTime,
CurrentTimeLog.concat(SubItemTimeLog).concat(RecurTrackingCurrentSubLog).concat(RecurTrackingSubfromMainLog).flat().unique(),
	
	TotalAllTime,
CurrentTimeLog.concat(SubItemTimeLog).concat(RecurTrackingAll).concat(SubRecurTrackingAll).flat().unique(),
	
	LastSessionTimesStart,
	TotalAllTime.sort(current.prop("Start Time")).filter(current.prop("Start Time")).map(current.prop("Start Time")).last(),
	
	LastSessionTimesEnd,
	TotalAllTime.sort(current.prop("End Time")).filter(current.prop("End Time")).map(current.prop("End Time")).last(),
	
	TimeSwitch,
	ifs(prop("Tracking Switch").contains("Current"),
		TotalCurrentTime.map(current.prop("logged time (min)")).sum(),
		prop("Tracking Switch").contains("All"),
		TotalAllTime.map(current.prop("logged time (min)")).sum()),
	
	TimeConversions,
if(TimeSwitch.toNumber()>60,
	(round((TimeSwitch/60) * 100)/100).format().split(".").first().toNumber()
	 + "hr(s) " + round(((round((TimeSwitch/60) * 100)/100).format().split(".").last().toNumber() /100) * 60) + "min",
	TimeSwitch + "min"),
			
			EstLengthConv,
			ifs(prop("Est. (min or hrs?)").contains("hours"),
			prop("Est. Length") * 60,
			prop("Est. (min or hrs?)").contains("min"),
			prop("Est. Length")
	
			),
			
			GoalLengthCov,
						ifs(
					prop("Goal (min or hrs?)").contains("hours"),
					prop("Goal Number")* 60,
							prop("Goal (min or hrs?)").contains("min"),
					prop("Goal Number")
			),
			
			LeftinEst,
			 EstLengthConv - TotalCurrentTime.map(current.prop("logged time (min)")).sum(),
			
		  LeftEstConv,
			if(LeftinEst>60,
			round((LeftinEst/60)* 100 )/ 100 + "hrs",
				LeftinEst + "min"),
				
				LeftinGoal,
			 GoalLengthCov - TotalAllTime.map(current.prop("logged time (min)")).sum(),
				
			
		  LeftEstGoal,
			if(LeftinGoal>60,
			round((LeftinGoal/60)* 100 )/ 100 + "hrs",
				LeftinGoal + "min"),
				
			
	TimeText,
	
		
		(
			
			ifs(CurrentSessionTimes.empty(),
		LastSessionTimesStart.formatDate("h:mm A") + "→" + LastSessionTimesEnd.formatDate("h:mm A"),
		

		CurrentSessionTimes.dateStart().formatDate("h:mm A") + "→" + CurrentSessionTimes.dateEnd().formatDate("h:mm A")
		)
		).style("b","u",
			
			ifs(prop("Status").contains("⌚"),
				"purple",
	prop("Status").contains("✅"),
			"green",
			"orange"),
				if(prop("Status").contains("⌚"),
					"u",
					"")
					),
					
	
		  

LeftinSessionText,
(
		if(prop("Status").contains("✅"),
			dateBetween(LastSessionTimesEnd,LastSessionTimesStart, "minutes") * 
				if(
					dateBetween(LastSessionTimesEnd,LastSessionTimesStart,"minutes")>60,
					0.017,
					1)
					+ if(dateBetween(LastSessionTimesEnd,LastSessionTimesStart,"minutes")>60, 
						"hr(s)",
						"min") 
						+ 
						" Last Session", 

LeftSessConv)
 + 

ifs(LeftinSession>0 and !prop("Status").contains("✅"),
" Left in Session",
LeftinSession<0 and !prop("Status").contains("✅"),
" Over Session!",
LeftinSession.empty() and !prop("Status").contains("✅"),
" No Stats")

).style(
			
			ifs(prop("Status").contains("⌚"),
			"purple",
			prop("Status").contains("✅"),
			"green",
			"orange"),
					if(prop("Status").contains("⌚"),
			"c",
			""),			
			if(LeftinSession<0,
			"s",
			"")
		

		),
		
		LeftinEstText,
	(LeftEstConv + 
ifs(LeftinEst>0,
" to ✅",
LeftinEst<0,
" Over ✅"

)).style(			
	
	if(prop("Status").contains("⌚"),
			"purple",
			"blue"),
					ifs(prop("Status").contains("⌚"),
			"c",
			""),
			if(LeftinEst<0,
			"s",
			"")

	)
,

		LeftinGoalText,
	(LeftEstGoal + 
ifs(LeftinGoal>0,
" to ⚽",
LeftinGoal<0,
" Over ⚽"

)).style(			
	
	ifs(prop("Status").contains("⌚"),
			"purple",
			LeftinGoal<0,
			"green",
			"blue"),
					ifs(prop("Status").contains("⌚"),
			"c",
			""),
			if(LeftinGoal<0,
			"s",
			"")

	)
,

TotaltimeTracked,
	(TimeConversions + " Tracked ").style("b","u",
			
			if(prop("Status").contains("⌚"),
				"purple",
				"blue"),
				if(prop("Status").contains("⌚"),
					"u",
					"") 
					
					
					).style(if(
						LeftinSession<0,
						"red",
						""),
						if(
						LeftinSession<0,
						"red_background",
						"")
						
						
						)
						,

			if(TimeText.empty(),
				"",
			"| ".style("b") + TimeText + " | ".style("b")) + 
prop("Task Type") + " |".style("b") +
if(TotaltimeTracked.match("\d+") == LeftinSessionText.match("\d+") or !LeftinSessionText,
				"","
| ".style("b") +
if(prop("Status").contains("⌚"),
	("Current Time: " + now().formatDate("hh:mm A")).style("purple","b","u") + " |
| ".style("b"),
"") +

				LeftinSessionText + " |
| ".style("b") + if(prop("Status").contains("✅"),
	"",(SessionLengthConv + "min in ⏲️" ).style(
	ifs(prop("Status").contains("⌚"),
		"u",
		"")
		,ifs(prop("Status").contains("⌚"),
			"purple",
			"blue")
			) + " |".style("b"))) +
if((prop("Est. Length")), 
"
| ".style("b") + LeftinEstText + " |".style("b"), 
"") +

if((prop("Goal Number")), 
"
| ".style("b") + LeftinGoalText + " |".style("b"), 
"") +
	
"
| ".style("b") + TotaltimeTracked.style("b") + " |".style("b")

	
)
```

**Dependencies**:
- `Sub-Actions` (Relation to sub-tasks)
- `Time Log` (Relation to time log entries)
- `Recur Tracking` (Relation to recurring task completions)
- `Status`, `Tracking Switch`, `Goal Number`, `Goal (min or hrs?)`
- `Sess. Length`, `Sess. (min or hrs?)`
- `Est. Length`, `Est. (min or hrs?)`
- `Completion Time`, `First Due Date`, `Created time`
- `Task Type`

**Backend Implementation Notes**:
- This aggregates time log data from multiple relations (main task, subtasks, recurring completions)
- Computes total time, session counts, goal progress
- Can be replaced with SQL queries + application logic
- Store computed values in dedicated SQLite columns for display

---

## Formula 2: Flattened Time Log Rollup

**Purpose**: Combines all time logs from current task, subtasks, and recurring completions

**Formula**:
```notion
prop("Time Log").concat(prop("RecurTrack_TimeLog_Roll")).flat().concat(prop("Sub-Actions").map(current.prop("Time Log")).flat()).flat().concat(prop("SubAction_Recur_Roll").map(current.prop("Time Log")).flat()).flat().filter(!current.prop("Parent item") and current.prop("Type of Action").format()=="Sub")
```

**Dependencies**:
- `Time Log`, `RecurTrack_TimeLog_Roll`, `SubAction_Recur_Roll`
- `Sub-Actions` (Relation)
- `Parent item`, `Type of Action`

**Backend Implementation**:
- Query time log repository with task relations
- Filter by parent/sub-item type
- Return flattened array

---

## Formula 3: Recurrence Check

**Purpose**: Determines if task has a recurrence interval set via main action relation

**Formula**:
```notion
if(prop("Main Actions").map(current.prop("Recur Interval")).first().toNumber()>0,
true,
false)
```

**Dependencies**:
- `Main Actions` (Relation)
- `Recur Interval` (Number property on related items)

**Backend Implementation**:
- Check if `mainActionId` exists in database
- Query main action's `recurInterval` field
- Return boolean

---

## Formula 4: Writing Logs Summary

**Purpose**: Counts open and total writing logs across task, subtasks, and recurrences

**Formula**:
```notion
lets(
	AllWritingLogs,
	prop("writing logs").concat(prop("Sub-Actions").map(current.prop("writing logs"))).concat(prop("Recur Tracking").map(current.prop("writing logs"))).concat(prop("Recur Tracking").map(current.prop("Sub-Actions")).flat().map(current.prop("writing logs"))).flat(),
	
	OpenLogs,
	AllWritingLogs.filter(!current.prop("Status").contains("🗃️")).length(),
	
	TotalLogs,
	AllWritingLogs.length(),
	
	("# Open Logs: " + OpenLogs).style("b","green","c") + "
" + ("# Total Logs: " + TotalLogs).style("b","brown","c")
	
	)
```

**Dependencies**:
- `writing logs` (Relation to writing database)
- `Sub-Actions`, `Recur Tracking` (Relations)
- `Status` on writing log entries

**Backend Implementation**:
- Query writing logs related to task and all its subtasks/recurrences
- Filter by status (open = not archived)
- Return formatted counts

---

## Formula 5: Total Logged Time (All Time)

**Purpose**: Sums all logged time from task, subtasks, and recurrences

**Formula**:
```notion
lets(
	AllStatuses,
	prop("Sub-Actions").map(current.prop("Status")).flat().join("," + prop("Status")),
	
		CurrentTimeLog,
		prop("Time Log").flat(),
	
		SubItemTimeLog,
	prop("Sub-Actions").map(current.prop("Time Log")).flat(),
	
	RecurTrackingAll,
		prop("Recur Tracking").map(current.prop("Time Log")).flat(),
		
		SubRecurTrackingAll,
			prop("Sub-Actions").map(current.prop("Recur Tracking")).flat().map(current.prop("Time Log")).flat(),
	
	TotalAllTime,
CurrentTimeLog.concat(SubItemTimeLog).concat(RecurTrackingAll).concat(SubRecurTrackingAll).flat().unique(),	
	
		TotalAllTime.map(current.prop("logged time (min)")).sum()
	
	)
```

**Backend Implementation**:
- Query all time logs: `SELECT SUM(duration_minutes) FROM time_logs WHERE task_id IN (...)`
- Include main task, subtasks, recurring completions
- Store in `total_logged_minutes` column

---

## Formula 6: Time Tracking Switch (Current vs All)

**Purpose**: Returns time sum based on "Current" or "All" tracking mode

**Formula**:
```notion
lets(
	AllStatuses,
	prop("Sub-Actions").map(current.prop("Status")).flat().join("," + prop("Status")),
	
		CurrentTimeLog,
		prop("Time Log").flat(),
	
		SubItemTimeLog,
	prop("Sub-Actions").map(current.prop("Time Log")).flat(),
	
	RecurTrackingAll,
		prop("Recur Tracking").map(current.prop("Time Log")).flat(),
		
		SubRecurTrackingAll,
			prop("Sub-Actions").map(current.prop("Recur Tracking")).flat().map(current.prop("Time Log")).flat(),
	
	RecurTrackingCurrentSubLog,
			prop("Recur Tracking").map(current.prop("Time Log")).flat().filter(!current.prop("Task Done!")).flat(),
			
			RecurTrackingSubfromMainLog,
			prop("Sub-Actions").map(current.prop("Recur Tracking")).flat().map(current.prop("Time Log")).flat().filter(!current.prop("Task Done!")).flat(),
	
	TotalCurrentTime,
CurrentTimeLog.concat(SubItemTimeLog).concat(RecurTrackingCurrentSubLog).concat(RecurTrackingSubfromMainLog).flat().unique(),
	
	TotalAllTime,
CurrentTimeLog.concat(SubItemTimeLog).concat(RecurTrackingAll).concat(SubRecurTrackingAll).flat().unique(),	
	
	TimeSwitch,
	ifs(prop("Tracking Switch").contains("Current"),
		TotalCurrentTime.map(current.prop("logged time (min)")).sum(),
		prop("Tracking Switch").contains("All"),
		TotalAllTime.map(current.prop("logged time (min)")).sum()),
	
	TimeSwitch
	)
```

**Backend Implementation**:
- Add `tracking_mode` field: 'current' | 'all'
- Compute time sum based on mode:
  - Current: Only non-completed recurring instances
  - All: All time logs ever
- Store in `computed_time_minutes` column

---

## Migration Strategy

1. **Delete these formula properties from Notion** to reduce database load (target: <100 properties)
2. **Implement computations in SQLite/application layer**
3. **Add computed columns** to `tasks` table:
   - `total_logged_minutes` (Number)
   - `session_count` (Number)
   - `completion_count` (Number)
   - `goal_remaining_minutes` (Number)
   - `last_session_start` (ISO timestamp)
   - `last_session_end` (ISO timestamp)
4. **Update these computed fields** when:
   - Time log entry is created/updated
   - Task status changes
   - Recurring completion added
5. **Optionally sync computed values back to Notion** as simple Number/Text properties (not formulas)

---

## Performance Impact

**Before** (with formulas):
- 504 Gateway Timeouts on every query
- Unable to import active tasks
- 0 / 30 open tasks visible in app

**After** (backend computation):
- Fast queries (< 1 second)
- Reliable active task import
- All 30 open tasks visible
- Computed values updated in real-time via SQLite triggers


