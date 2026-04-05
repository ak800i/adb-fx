$adb = Join-Path $PSScriptRoot "platform-tools\adb.exe"
& $adb shell 'mkdir -p /storage/emulated/0/test-delete && cd /storage/emulated/0/test-delete && i=0; while [ $i -lt 300 ]; do i=$((i+1)); touch file_$i.txt; done'
