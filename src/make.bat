@echo off

if "%1" == "clean" goto clean
if "%1" == "view" goto view

REM Define targets
:help
echo Please use `make ^<target^>` where ^<target^> is one of
echo   clean            to clean HTML files
echo   view             to view the built HTML
goto :eof

:clean
rmdir /s /q public resources
goto :eof

:view
python -c "import webbrowser; webbrowser.open_new_tab(r'file:///%cd%\public\index.html')"
goto :eof
