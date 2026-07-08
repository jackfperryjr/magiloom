# countdown.cmd — engine-only demo (sends NOTHING to the game).
# Watch it run live in the Scripts panel: setvariable, math, if...then, pause.
setvariable n 5
loop:
   echo Liftoff in %n ...
   math n subtract 1
   pause 1
   if %n > 0 then goto loop
echo Liftoff!
exit
