package api

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/ovh/cds/engine/api/services"
	"github.com/ovh/cds/engine/api/services/mock_services"
	"go.uber.org/mock/gomock"

	"github.com/ovh/cds/engine/api/test"
	"github.com/ovh/cds/engine/api/test/assets"
	"github.com/ovh/cds/sdk"
	"github.com/stretchr/testify/require"
)

func Test_crudRepositoryHookOnProjectLambdaUserOK(t *testing.T) {
	api, db, _ := newTestAPI(t)

	proj := assets.InsertTestProject(t, db, api.Cache, sdk.RandomString(10), sdk.RandomString(10))
	user1, pass := assets.InsertLambdaUser(t, db)

	vcsProj := assets.InsertTestVCSProject(t, db, proj.ID, "vcs-github", "github")

	// Insert rbac
	assets.InsertRBAcProject(t, db, "manage", proj.Key, *user1)
	assets.InsertRBAcProject(t, db, "read", proj.Key, *user1)

	// Mock VCS
	s, _ := assets.InsertService(t, db, t.Name()+"_VCS", sdk.TypeVCS)
	sHooks, _ := assets.InsertService(t, db, t.Name()+"_HOOK", sdk.TypeHooks)
	// Setup a mock for all services called by the API
	ctrl := gomock.NewController(t)
	defer ctrl.Finish()
	servicesClients := mock_services.NewMockClient(ctrl)
	services.NewClient = func(_ []sdk.Service) services.Client {
		return servicesClients
	}
	defer func() {
		_ = services.Delete(db, s)
		_ = services.Delete(db, sHooks)
		services.NewClient = services.NewDefaultClient
	}()

	generatedHook := &sdk.GenerateRepositoryWebhook{
		UUID: sdk.UUID(),
	}
	servicesClients.EXPECT().DoJSONRequest(gomock.Any(), "GET", "/vcs/vcs-github/repos/ovh/cds", gomock.Any(), gomock.Any(), gomock.Any()).Times(1)
	url := "/v2/repository/key/" + proj.Key + "/" + vcsProj.Name + "/ovh%2Fcds"
	servicesClients.EXPECT().DoJSONRequest(gomock.Any(), "POST", url, gomock.Any(), gomock.Any()).DoAndReturn(func(ctx context.Context, method, path string, in interface{}, out interface{}, _ ...interface{}) (http.Header, int, error) {
		*(out.(*sdk.GenerateRepositoryWebhook)) = *generatedHook
		return nil, 200, nil
	}).MaxTimes(1)

	// Creation request
	hook := sdk.PostProjectWebHook{
		VCSServer:  vcsProj.Name,
		Repository: "ovh/cds",
	}

	vars := map[string]string{
		"projectKey": proj.Key,
	}
	uri := api.Router.GetRouteV2("POST", api.postRepositoryHookHandler, vars)
	test.NotEmpty(t, uri)
	req := assets.NewAuthentifiedRequest(t, user1, pass, "POST", uri, nil)

	bts, _ := json.Marshal(hook)
	// Here, we insert the vcs server as a CDS user (not administrator)
	req.Body = io.NopCloser(bytes.NewReader(bts))
	req.Header.Set("Content-Type", "application/json")

	w := httptest.NewRecorder()
	api.Router.Mux.ServeHTTP(w, req)
	require.Equal(t, 200, w.Code)

	var responseCreate sdk.HookAccessData
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &responseCreate))

	urlsplit := strings.Split(responseCreate.URL, "/")
	vars["uuid"] = urlsplit[len(urlsplit)-1]

	// Then, get the hook
	uriGet := api.Router.GetRouteV2("GET", api.getRepositoryHookHandler, vars)
	test.NotEmpty(t, uriGet)
	reqGet := assets.NewAuthentifiedRequest(t, user1, pass, "GET", uriGet, nil)
	w2 := httptest.NewRecorder()
	api.Router.Mux.ServeHTTP(w2, reqGet)
	require.Equal(t, 200, w2.Code)

	// Then Delete repository
	varsDelete := vars
	uriDelete := api.Router.GetRouteV2("DELETE", api.deleteRepositoryHookHandler, varsDelete)
	test.NotEmpty(t, uriDelete)
	reqDelete := assets.NewAuthentifiedRequest(t, user1, pass, "DELETE", uriDelete, nil)
	w3 := httptest.NewRecorder()
	api.Router.Mux.ServeHTTP(w3, reqDelete)
	require.Equal(t, 204, w3.Code)
}
