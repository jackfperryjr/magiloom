# look.cmd — simplest real game interaction: send a command, wait for the prompt.
# 'wait' resolves on the next game command prompt, so it is safe in any room.
echo Looking around...
put look
wait
echo Done -- the room is shown above.
exit
