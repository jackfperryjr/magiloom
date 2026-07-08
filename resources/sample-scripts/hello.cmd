# hello.cmd — smoke test: echo, $charname, arguments, if_N, gosub.
# Sends nothing to the game. Run it two ways to see arguments work:
#   .hello
#   .hello sword shield
echo Hello, $charname!
if_1 goto hadargs
echo No arguments given. Try:  .hello sword shield
goto greet
hadargs:
echo You passed: %0
echo Your first argument was: %1
greet:
gosub farewell
echo (hello.cmd finished)
exit

farewell:
echo Thanks for trying native scripts!
return
