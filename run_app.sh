#!/bin/bash

#    This file is part of WebBox.
#
#    Copyright 2011-2012 Daniel Alexander Smith
#    Copyright 2011-2012 University of Southampton
#
#    WebBox is free software: you can redistribute it and/or modify
#    it under the terms of the GNU General Public License as published by
#    the Free Software Foundation, either version 3 of the License, or
#    (at your option) any later version.
#
#    Foobar is distributed in the hope that it will be useful,
#    but WITHOUT ANY WARRANTY; without even the implied warranty of
#    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
#    GNU General Public License for more details.
#
#    You should have received a copy of the GNU General Public License
#    along with WebBox.  If not, see <http://www.gnu.org/licenses/>.


# to change back to current dir
export MACOSDIR="$( cd -P "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
cd "$MACOSDIR/../Resources"

export SSDIR=`pwd`
export SECURESTORE_HOME="$SSDIR"


bashtrap()
{
    echo "Exiting..."

    echo "Killing SecureStore, pid: $PID_SECURESTORE"
    kill "$PID_SECURESTORE"
    echo "Killing RWW, pid: $PID_RWW"
    kill "$PID_RWW"
    echo "Killing 4s-httpd, pid: $PID_4S_HTTPD"
    kill "$PID_4S_HTTPD"
    echo "Killing 4s-backend, pid: $PID_4S_BACKEND"
    kill "$PID_4S_BACKEND"
    echo "done."
}

# set up bash trap, will exec bashtrap() function on ctrl-c
trap bashtrap INT

cd "$SSDIR"
# do initial set up
if [ ! -f SETUP_DONE_V1 ]
then
    ./scripts/setup_4store.sh # create /var/lib/4store (prompts for admin password)
    ./scripts/new_4store_kb.sh # create securestore kb
fi
touch SETUP_DONE_V1

# run rww, output to log
cd "$SSDIR"
. scripts/run_rww.sh

cd "$SSDIR"
# run 4store, output to log
. scripts/run_4store.sh

cd "$SSDIR"
# run securestore, output to log
. scripts/config.sh

# TODO pop up a browser after "run" has started - put in run.py ?

# run the py2app runner and pass arguments along
../MacOS/run "$@"
export PID_SECURESTORE=$!

# terminate subprocesses of 4store and RWW
echo "WebBox terminated, calling bashtrap..."
bashtrap

