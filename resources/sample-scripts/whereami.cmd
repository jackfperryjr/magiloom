# whereami.cmd — the robust pattern: match + matchwait with a timeout.
# Sends LOOK, then waits up to 3s for the room's "Obvious paths/exits" line.
# Note: matches are checked in the order declared, and matchwait falls through
# to the next line if nothing matches before the timeout.
echo Checking the room's exits...
put look
match found obvious paths
match found obvious exits
matchwait 3
echo No exits line seen (timed out after 3s).
goto end
found:
echo Found the room's exits line above.
end:
echo (whereami.cmd finished)
exit
