#    Copyright (C) 2011-2014 University of Southampton
#    Copyright (C) 2011-2014 Daniel Alexander Smith
#    Copyright (C) 2011-2014 Max Van Kleek
#    Copyright (C) 2011-2014 Nigel R. Shadbolt
#
#    This program is free software: you can redistribute it and/or modify
#    it under the terms of the GNU Affero General Public License, version 3,
#    as published by the Free Software Foundation.
#
#    This program is distributed in the hope that it will be useful,
#    but WITHOUT ANY WARRANTY; without even the implied warranty of
#    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
#    GNU Affero General Public License for more details.
#
#    You should have received a copy of the GNU Affero General Public License
#    along with this program.  If not, see <http://www.gnu.org/licenses/>.
import logging
from twisted.internet import reactor
from indx.reactor import IndxResponse
from indx.webserver.session import INDXSession
from twisted.internet.defer import Deferred

class IndxReactor:

    def __init__(self, tokens):
        self.subscribers = []
        self.mappings = {} # indxed by base path, e.g. box name or auth/admin etc.
        self.sessions = {} # sessionid -> INDXSession
        self.tokens = tokens
        self.tokens.set_reactor(self) # ughh
        self.file_cache = {}
        self.running_pcs = {}

    ### File caching (to prevent multiple reads to static files)

    def open(self, filename):
        if filename not in self.file_cache:
            fh = open(filename)
            data = fh.read()
            fh.close()
            self.file_cache[filename] = data

        return self.file_cache[filename]

    ###
    #   Subscribe/Messaging
    ###

    def add_subscriber(self, subscriber):
        self.subscribers.append(subscriber)

    def del_subscriber(self, subscriber):
        try:
            self.subscribers.remove(subscriber)
        except Exception as e:
            pass

    def send(self, msg, match_properties={}):
        """ Send a message to subscribers that match the properties specified. """
        # run each matching subscriber's callback in a thread immediately
        map(lambda sub: reactor.callInThread(sub.callback, msg), filter(lambda x: x.matches(match_properties), self.subscribers))

    ###
    #   Task Runner Handling
    ###

    def run_post_connect(self, pcc, store):
        """ Run a post-connect runner on a store.
            Handles running one per reactor, to stop duplication.
        """
        pc_name = pcc.__name__

        already_running = False
        if pc_name in self.running_pcs:
            if store in self.running_pcs[pc_name]:
                already_running = True
            else:
                self.running_pcs[pc_name].append(store)
        else:
            self.running_pcs[pc_name] = [store]

        if not already_running:
            pc = pcc(store)
            d = pc.run_post_connect()
        else:
            d = Deferred()
            d.callback(True)
        return d


    ###
    #   Request/URL Handling
    ###

    def incoming(self, request):
        """ Incoming IndxRequest - could be from HTTP Server or from a WebSocket frame. """
        if request.base_path in self.mappings:

            for mapping in self.mappings[request.base_path]: # ordered
                if mapping.matches(request):
                    logging.debug("IndxReactor - using mapping: {0}".format(mapping))
                    return mapping.request(request)

        # no match
        logging.debug("IndxReactor - no mapping found, returning 404.")
        request.callback(IndxResponse(404, "Not Found"))

    def add_mapping(self, mapping):
        if mapping.base_path not in self.mappings:
            self.mappings[mapping.base_path] = []
        self.mappings[mapping.base_path].append(mapping) # ordered

    def get_session(self, request):
        logging.debug("INDXReactor getting session with ID: {0}".format(request.sessionid))
        session = self.sessions.get(request.sessionid)
        if session is None:
            session = INDXSession(request.sessionid)
            self.sessions[request.sessionid] = session

        return session

