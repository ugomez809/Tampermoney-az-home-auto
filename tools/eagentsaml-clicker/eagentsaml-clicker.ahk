#Requires AutoHotkey v2.0
#SingleInstance Force
Persistent

global IniPath := A_ScriptDir . "\eagentsaml-clicker.ini"
global Config := LoadConfig()
global State := Map(
  "paused", false,
  "bindAwaitingClick", false,
  "bindAwaitingSince", 0,
  "lastAutoClickAt", 0
)

InitializeTray()
ShowStatus("Running | F7 bind click point | F8 click now | F9 pause")
SetTimer Tick, Config["PollMs"]

F7:: {
  BeginBindClickPoint()
}
F8:: {
  ClickNowHotkey()
}
F9:: {
  TogglePauseHotkey()
}
^!F7:: {
  BeginBindClickPoint()
}
^!F8:: {
  ClickNowHotkey()
}
^!F9:: {
  TogglePauseHotkey()
}

#HotIf IsAwaitingBindClick()
~LButton:: {
  CompleteBindClickPoint()
}
Esc:: {
  CancelBindClickPoint("Bind cancelled")
}
#HotIf

Tick() {
  global Config, State

  if State["bindAwaitingClick"] {
    if (A_TickCount - State["bindAwaitingSince"]) >= Config["BindClickTimeoutMs"] {
      CancelBindClickPoint("Bind timed out")
    }
    return
  }

  if State["paused"] {
    return
  }

  hwnd := WinActive("A")
  if !hwnd {
    return
  }
  if !WindowMatches(hwnd) {
    return
  }
  activeUrl := ReadActiveUrl(hwnd)
  if !UrlMatches(activeUrl) {
    return
  }
  if !HasClickPoint() {
    return
  }

  if PerformWindowClick(hwnd, "auto") {
    State["lastAutoClickAt"] := A_TickCount
  }
}

LoadConfig() {
  global IniPath

  cfg := Map()
  cfg["BrowserClass"] := IniRead(IniPath, "target", "BrowserClass", "Chrome_WidgetWin_1")
  cfg["UrlNeedle"] := IniRead(IniPath, "target", "UrlNeedle", "https://eagentsaml.farmersinsurance.com/")
  cfg["ClickRatioX"] := ReadIniFloat("target", "ClickRatioX", 0.50)
  cfg["ClickRatioY"] := ReadIniFloat("target", "ClickRatioY", 0.30)
  cfg["PollMs"] := ReadIniInt("clicker", "PollMs", 10000)
  cfg["BindClickTimeoutMs"] := ReadIniInt("clicker", "BindClickTimeoutMs", 15000)
  cfg["MouseDownMs"] := ReadIniInt("clicker", "MouseDownMs", 40)
  cfg["RestoreMouse"] := ReadIniBool("clicker", "RestoreMouse", true)
  cfg["AddressBarSettleMs"] := ReadIniInt("clicker", "AddressBarSettleMs", 80)
  cfg["AddressBarRestoreMs"] := ReadIniInt("clicker", "AddressBarRestoreMs", 60)
  cfg["ClipboardWaitMs"] := ReadIniInt("clicker", "ClipboardWaitMs", 600)
  return cfg
}

ReadIniInt(section, key, defaultValue) {
  global IniPath

  raw := IniRead(IniPath, section, key, defaultValue)
  try {
    value := Floor((raw + 0))
  } catch {
    value := defaultValue
  }
  return value > 0 ? value : defaultValue
}

ReadIniFloat(section, key, defaultValue) {
  global IniPath

  raw := IniRead(IniPath, section, key, defaultValue)
  try {
    value := raw + 0
  } catch {
    value := defaultValue
  }
  if (value < 0) {
    return 0
  }
  if (value > 1) {
    return 1
  }
  return value
}

ReadIniBool(section, key, defaultValue) {
  global IniPath

  raw := IniRead(IniPath, section, key, defaultValue ? "1" : "0")
  text := StrLower(Trim(raw))
  return raw = "1" || text = "true" || text = "yes"
}

InitializeTray() {
  A_TrayMenu.Delete()
  A_TrayMenu.Add("Bind Click Point`tF7", BeginBindClickPoint)
  A_TrayMenu.Add("Click Now`tF8", ClickNowHotkey)
  A_TrayMenu.Add("Pause / Resume`tF9", TogglePauseHotkey)
  A_TrayMenu.Add()
  A_TrayMenu.Add("Exit", ExitAppMenu)
  A_IconTip := "Farmers SAML Clicker"
}

BeginBindClickPoint(*) {
  global State

  State["bindAwaitingClick"] := true
  State["bindAwaitingSince"] := A_TickCount
  ShowStatus("Click anywhere on the Farmers page once to bind its position")
}

CancelBindClickPoint(message := "") {
  global State

  State["bindAwaitingClick"] := false
  State["bindAwaitingSince"] := 0
  if message {
    ShowStatus(message)
  }
}

IsAwaitingBindClick() {
  global State
  return !!State["bindAwaitingClick"]
}

CompleteBindClickPoint() {
  global Config, IniPath

  MouseGetPos &mouseX, &mouseY, &clickedHwnd
  hwnd := GetRootWindow(clickedHwnd)
  if !hwnd {
    CancelBindClickPoint("No window found under click")
    return
  }
  if !WindowMatches(hwnd) {
    CancelBindClickPoint("Clicked window does not match configured browser class")
    return
  }
  activeUrl := ReadActiveUrl(hwnd)
  if !UrlMatches(activeUrl) {
    CancelBindClickPoint("Clicked tab is not on eagentsaml")
    return
  }

  if !TryGetClientRect(hwnd, &clientX, &clientY, &clientW, &clientH) {
    CancelBindClickPoint("Could not read browser client area")
    return
  }

  relX := Clamp((mouseX - clientX) / clientW, 0.0, 1.0)
  relY := Clamp((mouseY - clientY) / clientH, 0.0, 1.0)
  Config["ClickRatioX"] := relX
  Config["ClickRatioY"] := relY
  IniWrite Format("{:0.4f}", relX), IniPath, "target", "ClickRatioX"
  IniWrite Format("{:0.4f}", relY), IniPath, "target", "ClickRatioY"
  CancelBindClickPoint("Saved click point at " . Format("{:0.1f}%, {:0.1f}%", relX * 100, relY * 100))
}

ClickNowHotkey(*) {
  hwnd := WinActive("A")
  if !hwnd {
    ShowStatus("No active window to click")
    return
  }
  if !WindowMatches(hwnd) {
    ShowStatus("Active window is not the configured browser class")
    return
  }
  activeUrl := ReadActiveUrl(hwnd)
  if !UrlMatches(activeUrl) {
    ShowStatus("Active tab URL is not eagentsaml")
    return
  }
  if !HasClickPoint() {
    ShowStatus("No click point saved yet. Press F7 and click anywhere on the page once.")
    return
  }
  if PerformWindowClick(hwnd, "manual") {
    ShowStatus("Manual click sent")
  } else {
    ShowStatus("Manual click failed")
  }
}

TogglePauseHotkey(*) {
  global State

  State["paused"] := !State["paused"]
  ShowStatus(State["paused"] ? "Paused" : "Resumed")
}

ExitAppMenu(*) {
  ExitApp()
}

HasClickPoint() {
  global Config
  return Config["ClickRatioX"] >= 0 && Config["ClickRatioY"] >= 0
}

WindowMatches(hwnd) {
  global Config

  id := "ahk_id " . hwnd
  try className := WinGetClass(id)
  catch {
    return false
  }
  if (Trim(Config["BrowserClass"]) != "" && className != Config["BrowserClass"]) {
    return false
  }
  return true
}

UrlMatches(url) {
  global Config

  urlNeedle := StrLower(Trim(Config["UrlNeedle"]))
  if (urlNeedle = "") {
    return true
  }
  return InStr(StrLower(Trim(url)), urlNeedle) > 0
}

ReadActiveUrl(hwnd) {
  global Config

  if !WinActive("ahk_id " . hwnd) {
    return ""
  }

  savedClipboard := ClipboardAll()
  copiedUrl := ""
  try {
    A_Clipboard := ""
    SendEvent "^l"
    Sleep Config["AddressBarSettleMs"]
    SendEvent "^c"
    if ClipWait(Config["ClipboardWaitMs"] / 1000) {
      copiedUrl := A_Clipboard
    }
    SendEvent "{Escape}"
    Sleep Config["AddressBarRestoreMs"]
  } catch {
    copiedUrl := ""
  }
  try A_Clipboard := savedClipboard
  catch {}
  return Trim(copiedUrl)
}

PerformWindowClick(hwnd, source := "auto") {
  global Config

  if !TryGetClientRect(hwnd, &clientX, &clientY, &clientW, &clientH) {
    return false
  }

  screenX := Round(clientX + (clientW * Config["ClickRatioX"]))
  screenY := Round(clientY + (clientH * Config["ClickRatioY"]))

  MouseGetPos &oldX, &oldY
  DllCall("SetCursorPos", "int", screenX, "int", screenY)
  Sleep 30
  DllCall("mouse_event", "UInt", 0x0002, "UInt", 0, "UInt", 0, "UInt", 0, "UPtr", 0)
  Sleep Config["MouseDownMs"]
  DllCall("mouse_event", "UInt", 0x0004, "UInt", 0, "UInt", 0, "UInt", 0, "UPtr", 0)
  if Config["RestoreMouse"] {
    Sleep 20
    DllCall("SetCursorPos", "int", oldX, "int", oldY)
  }

  if (source != "auto") {
    return true
  }
  return true
}

TryGetClientRect(hwnd, &x, &y, &w, &h) {
  id := "ahk_id " . hwnd
  try {
    WinGetClientPos &x, &y, &w, &h, id
    return w > 0 && h > 0
  } catch {
    return false
  }
}

GetRootWindow(hwnd) {
  current := hwnd
  while current {
    try parent := DllCall("GetParent", "ptr", current, "ptr")
    catch {
      parent := 0
    }
    if !parent {
      break
    }
    current := parent
  }
  return current
}

Clamp(value, minValue, maxValue) {
  if (value < minValue) {
    return minValue
  }
  if (value > maxValue) {
    return maxValue
  }
  return value
}

ShowStatus(message) {
  ToolTip message
  SetTimer HideStatusToolTip, -1600
}

HideStatusToolTip() {
  ToolTip
}
